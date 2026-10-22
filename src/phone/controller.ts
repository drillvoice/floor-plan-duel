// The phone side of phone controllers, opened from the room's QR code
// (?join=CODE). Before a match: pick a side, a look and a name. During one:
// a joystick on the left, Dodge and Shoot on the right. The phone only sends
// its controls; the game itself runs on the desktop.

import type { DataConnection, Peer } from 'peerjs';
import { cycleLook, LOOKS } from '../render/looks';
import {
  cleanName,
  normalizeRoomCode,
  parseHost,
  PEER_PREFIX,
  type HostMessage,
  type PadMessage,
} from '../net/protocol';
import type { PlayerIndex } from '../sim/types';
import { el } from '../screens/dom';

const SEND_EVERY = 50; // ms between messages when nothing changes
const HOST_TIMEOUT = 3000; // ms without word from the desktop before reconnecting
// Joystick: how far the thumb travels, the dead zone in the middle, and
// how far out counts as full speed (so you don't have to push to the rim).
const STICK_RADIUS = 56; // px
const DEAD_ZONE = 0.12;
const FULL_TILT = 0.75;

const ID_KEY = 'fpd.pad.id';
const NAME_KEY = 'fpd.pad.name';
const LOOK_KEY = 'fpd.pad.look';

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not saved; fine for this visit.
  }
}

const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

type Link = 'connecting' | 'connected' | 'notFound' | 'lost';

export function startController(joinParam: string): void {
  document.title = 'Floor Plan Duel · Controller';
  document.body.classList.add('pad-page');
  document.getElementById('game')?.remove();
  document.getElementById('fullscreen')?.remove();
  // A controller should never zoom on a double tap.
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  document.head.append(el('style', { textContent: CSS }));
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  const id = stored(ID_KEY) ?? randomId();
  store(ID_KEY, id);
  const savedLook = stored(LOOK_KEY);
  const pad: PadMessage = {
    t: 'pad',
    id,
    boot: randomId(),
    seq: 0,
    name: stored(NAME_KEY) ?? '',
    // A random animal until they pick one.
    look: savedLook !== null && LOOKS.includes(savedLook) ? savedLook : LOOKS[1 + Math.floor(Math.random() * (LOOKS.length - 1))],
    want: null,
    x: 0,
    y: 0,
    shoot: false,
    shots: 0,
    dodges: 0,
    starts: 0,
    pauses: 0,
  };

  let code = normalizeRoomCode(joinParam);
  let peer: Peer | null = null;
  let conn: DataConnection | null = null;
  let link: Link = 'connecting';
  let host: HostMessage | null = null;
  let heardAt = 0;
  let lastBuzz = -1;
  let retry = 0;

  const root = el('div', { id: 'pad-root' });
  document.body.append(root);

  // --- Connection ---------------------------------------------------------

  function send(): void {
    if (!conn?.open) return;
    pad.seq++;
    try {
      void conn.send(pad);
    } catch {
      // Channel closing; the timeout reconnects.
    }
  }
  setInterval(send, SEND_EVERY);

  function scheduleRetry(ms: number): void {
    clearTimeout(retry);
    retry = window.setTimeout(connect, ms);
  }

  async function connect(): Promise<void> {
    if (!code) return;
    clearTimeout(retry);
    conn?.close();
    conn = null;
    if (link !== 'notFound') link = host ? 'lost' : 'connecting';
    render();
    let PeerClass: typeof Peer;
    try {
      PeerClass = (await import('peerjs')).Peer;
    } catch {
      link = 'lost';
      render();
      scheduleRetry(3000);
      return;
    }
    if (!peer || peer.destroyed) {
      const p = new PeerClass();
      peer = p;
      p.on('error', (err) => {
        if (err.type === 'peer-unavailable') {
          link = 'notFound';
          render();
          scheduleRetry(3000);
        } else if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(err.type)) {
          if (link === 'connected') return; // the desktop link doesn't need the server
          link = host ? 'lost' : 'connecting';
          render();
          p.destroy();
          scheduleRetry(3000);
        }
      });
      p.on('disconnected', () => {
        if (!p.destroyed) p.reconnect();
      });
      await new Promise<void>((resolve) => {
        if (p.open) resolve();
        else p.once('open', () => resolve());
      });
      if (p !== peer) return;
    }
    const c = peer.connect(PEER_PREFIX + code, { reliable: false, serialization: 'json' });
    conn = c;
    c.on('open', () => {
      if (c !== conn) return;
      heardAt = performance.now();
      send();
    });
    c.on('data', (data) => {
      const msg = parseHost(data);
      if (c !== conn || !msg) return;
      heardAt = performance.now();
      clearTimeout(retry);
      const wasConnected = link === 'connected';
      link = 'connected';
      if (lastBuzz >= 0 && msg.buzz > lastBuzz) navigator.vibrate?.(msg.buzz - lastBuzz > 1 ? [120, 60, 120] : 160);
      lastBuzz = msg.buzz;
      const changed = !wasConnected || JSON.stringify(msg) !== JSON.stringify(host);
      host = msg;
      if (changed) render();
    });
    c.on('close', () => {
      if (c !== conn) return;
      if (link === 'connected') link = 'lost';
      render();
      scheduleRetry(1000);
    });
    // No answer at all: the room may be gone, or the network blocks us.
    scheduleRetry(8000);
  }

  // The desktop went quiet: reconnect.
  setInterval(() => {
    if (link === 'connected' && performance.now() - heardAt > HOST_TIMEOUT) {
      link = 'lost';
      release();
      render();
      void connect();
    }
  }, 500);

  // Coming back from a locked screen: reconnect straight away.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      release();
      return;
    }
    void keepAwake();
    if (link !== 'connected') void connect();
  });

  // --- Screen wake lock ---------------------------------------------------

  let wakeLock: { release(): Promise<void> } | null = null;
  async function keepAwake(): Promise<void> {
    if (wakeLock || !('wakeLock' in navigator)) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => (wakeLock = null));
    } catch {
      // Not allowed right now (e.g. not a secure page); the screen may dim.
    }
  }
  document.addEventListener('pointerdown', () => void keepAwake(), { capture: true });

  // --- Controls -----------------------------------------------------------

  // Lets go of everything, e.g. when the page is hidden mid-press.
  function release(): void {
    pad.x = 0;
    pad.y = 0;
    pad.shoot = false;
    stick = null;
    shootPointer = null;
    send();
  }

  let stick: { pointer: number; ox: number; oy: number } | null = null;
  let shootPointer: number | null = null;

  function buildPad(h: HostMessage, slot: PlayerIndex): HTMLElement {
    const color = h.colors[slot];
    const zone = el('div', { className: 'stick-zone' });
    const base = el('div', { className: 'stick-base' });
    const knob = el('div', { className: 'stick-knob' });
    base.append(knob);
    zone.append(base, el('div', { className: 'zone-label', textContent: 'move' }));
    const placeBase = (x: number, y: number) => {
      const r = zone.getBoundingClientRect();
      base.style.left = `${x - r.left}px`;
      base.style.top = `${y - r.top}px`;
    };
    const setKnob = (dx: number, dy: number) => (knob.style.transform = `translate(${dx}px, ${dy}px)`);
    zone.addEventListener('pointerdown', (e) => {
      if (stick) return;
      zone.setPointerCapture(e.pointerId);
      stick = { pointer: e.pointerId, ox: e.clientX, oy: e.clientY };
      placeBase(e.clientX, e.clientY);
      base.classList.add('active');
      setKnob(0, 0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (!stick || e.pointerId !== stick.pointer) return;
      let dx = e.clientX - stick.ox;
      let dy = e.clientY - stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        // Past the rim, the stick follows the thumb so reversing is instant.
        stick.ox += (dx * (d - STICK_RADIUS)) / d;
        stick.oy += (dy * (d - STICK_RADIUS)) / d;
        placeBase(stick.ox, stick.oy);
        dx = e.clientX - stick.ox;
        dy = e.clientY - stick.oy;
      }
      setKnob(dx, dy);
      const tilt = Math.min(1, Math.hypot(dx, dy) / STICK_RADIUS);
      const speed = tilt < DEAD_ZONE ? 0 : Math.min(1, (tilt - DEAD_ZONE) / (FULL_TILT - DEAD_ZONE));
      const len = Math.hypot(dx, dy) || 1;
      const nx = (dx / len) * speed;
      const ny = (dy / len) * speed;
      if (nx !== pad.x || ny !== pad.y) {
        pad.x = nx;
        pad.y = ny;
        send();
      }
    });
    const endStick = (e: PointerEvent) => {
      if (!stick || e.pointerId !== stick.pointer) return;
      stick = null;
      base.classList.remove('active');
      base.style.left = '';
      base.style.top = '';
      setKnob(0, 0);
      pad.x = 0;
      pad.y = 0;
      send();
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    const dodge = el('button', { className: 'btn dodge', type: 'button', textContent: 'Dodge' });
    dodge.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.dodges++;
      send();
      dodge.classList.add('down');
      navigator.vibrate?.(10);
    });
    const shoot = el('button', { className: 'btn shoot', type: 'button', textContent: 'Shoot' });
    shoot.style.background = color;
    shoot.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      shoot.setPointerCapture(e.pointerId);
      shootPointer = e.pointerId;
      pad.shoot = true;
      pad.shots++;
      send();
      shoot.classList.add('down');
    });
    const endShoot = (e: PointerEvent) => {
      if (e.pointerId !== shootPointer) return;
      shootPointer = null;
      pad.shoot = false;
      send();
      shoot.classList.remove('down');
    };
    shoot.addEventListener('pointerup', endShoot);
    shoot.addEventListener('pointercancel', endShoot);
    for (const t of ['pointerup', 'pointercancel', 'pointerleave'] as const) dodge.addEventListener(t, () => dodge.classList.remove('down'));

    const pause = el('button', { className: 'pause', type: 'button', textContent: h.screen === 'paused' ? '▶' : '❚❚', ariaLabel: 'Pause' });
    pause.addEventListener('click', () => {
      pad.pauses++;
      send();
    });
    const tag = el('div', { className: 'tag', textContent: `${pad.look} ${pad.name || `P${slot + 1}`}`.trim() });
    tag.style.color = color;

    const screen = el('div', { className: 'pad' }, [
      el('div', { className: 'top' }, [tag, pause]),
      zone,
      el('div', { className: 'buttons' }, [dodge, shoot]),
    ]);
    screen.style.setProperty('--player', color);
    if (h.screen === 'paused') screen.append(el('div', { className: 'paused', textContent: 'Paused' }));
    return screen;
  }

  // --- Screens ------------------------------------------------------------

  function joinForm(): HTMLElement {
    const input = el('input', { type: 'text', placeholder: 'ABCD', maxLength: 6, autocapitalize: 'characters', ariaLabel: 'Room code' });
    input.autocomplete = 'off';
    const go = el('button', { className: 'primary', type: 'submit', textContent: 'Join' });
    const msg = el('p', { className: 'muted', textContent: 'Type the room code shown on the big screen.' });
    const form = el('form', { className: 'card' }, [el('h1', { textContent: 'Join a game' }), msg, input, go]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const c = normalizeRoomCode(input.value);
      if (!c) {
        msg.textContent = 'Codes are four letters, like BKMZ.';
        return;
      }
      code = c;
      history.replaceState(null, '', `?join=${c}`);
      link = 'connecting';
      void connect();
    });
    queueMicrotask(() => input.focus());
    return form;
  }

  function statusCard(): HTMLElement {
    const text =
      link === 'notFound'
        ? `No room ${code} right now. Check the code on the big screen; still trying…`
        : link === 'lost'
          ? 'Lost the connection. Reconnecting…'
          : `Joining room ${code}…`;
    const other = el('button', { type: 'button', textContent: 'Use a different code' });
    other.addEventListener('click', () => {
      code = null;
      host = null;
      clearTimeout(retry);
      conn?.close();
      conn = null;
      history.replaceState(null, '', '?join');
      render();
    });
    return el('div', { className: 'card' }, [el('h1', { textContent: 'Floor Plan Duel' }), el('p', { className: 'muted', textContent: text }), other]);
  }

  function lobby(h: HostMessage): HTMLElement {
    const sides = h.colors.map((_, i) => {
      const mine = h.slot === i;
      const holder = h.taken[i];
      const b = el('button', {
        type: 'button',
        className: `side${mine ? ' mine' : ''}`,
        disabled: !mine && holder !== null,
      }, [el('strong', { textContent: `P${i + 1}` }), el('span', { textContent: mine ? 'You' : holder ?? 'Free' })]);
      b.style.setProperty('--side', h.colors[i]);
      b.addEventListener('click', () => {
        pad.want = i;
        send();
      });
      return b;
    });

    const lookBtn = (step: 1 | -1, label: string) => {
      const b = el('button', { type: 'button', className: 'arrow', textContent: label });
      b.addEventListener('click', () => {
        pad.look = cycleLook(pad.look, step);
        store(LOOK_KEY, pad.look);
        lookFace.textContent = pad.look || '';
        send();
      });
      return b;
    };
    const lookFace = el('div', { className: 'face', textContent: pad.look });
    if (h.slot !== null) lookFace.style.background = h.colors[h.slot];

    const name = el('input', { type: 'text', value: pad.name, maxLength: 16, placeholder: 'Your name', ariaLabel: 'Your name' });
    name.autocomplete = 'off';
    name.addEventListener('input', () => {
      pad.name = cleanName(name.value);
      store(NAME_KEY, pad.name);
      send();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') name.blur();
    });

    const start = el('button', {
      type: 'button',
      className: 'primary',
      textContent: h.screen === 'over' ? 'Rematch ▶' : 'Start match ▶',
      disabled: !h.canStart,
    });
    start.addEventListener('click', () => {
      pad.starts++;
      send();
      // Full screen hides the browser bar during the match, where allowed.
      void document.documentElement.requestFullscreen?.().catch(() => {});
    });

    const note =
      h.slot === null
        ? 'Every side is taken. You can play when someone leaves.'
        : h.screen === 'match' || h.screen === 'paused'
          ? 'A match is on.'
          : h.screen === 'over'
            ? 'Match over! Start a rematch from here or the big screen.'
            : h.canStart
              ? 'Start here or press Enter on the big screen.'
              : 'Waiting for the big screen…';

    return el('div', { className: 'card' }, [
      el('div', { className: 'room muted', textContent: `Room ${code} · connected` }),
      el('h1', { textContent: 'Pick your side' }),
      el('div', { className: 'sides' }, sides),
      el('div', { className: 'look-row' }, [lookBtn(-1, '◀'), lookFace, lookBtn(1, '▶')]),
      name,
      start,
      el('p', { className: 'muted', textContent: note }),
    ]);
  }

  let view = '';
  function render(): void {
    let next: string;
    if (!code) next = 'join';
    else if (link !== 'connected' || !host) next = `status:${link}`;
    else if ((host.screen === 'match' || host.screen === 'paused') && host.slot !== null) next = `pad:${host.slot}:${host.screen}:${host.colors}`;
    else next = `lobby:${JSON.stringify({ ...host, buzz: 0 })}`;
    // Rebuilding the pad mid-press would drop the touch, so only rebuild
    // when the screen really changes; the lobby keeps a half-typed name.
    if (next === view) return;
    const typing = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
    if (typing && next.startsWith('lobby:') && view.startsWith('lobby:')) {
      // Update the rest of the lobby after they finish typing.
      typing.addEventListener('blur', () => render(), { once: true });
      return;
    }
    const enteringPad = next.startsWith('pad:') && !view.startsWith('pad:');
    view = next;
    if (!next.startsWith('pad:')) release();
    if (enteringPad) release();
    if (!code) root.replaceChildren(joinForm());
    else if (link !== 'connected' || !host) root.replaceChildren(statusCard());
    else if ((host.screen === 'match' || host.screen === 'paused') && host.slot !== null) root.replaceChildren(buildPad(host, host.slot));
    else root.replaceChildren(lobby(host));
  }

  render();
  void connect();
}

const CSS = `
body.pad-page {
  overflow: hidden;
  font: 16px system-ui, sans-serif;
  color: #f2efe8;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  -webkit-tap-highlight-color: transparent;
  overscroll-behavior: none;
}
#pad-root {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
#pad-root .card {
  width: 100%;
  max-width: 420px;
  max-height: 100%;
  overflow-y: auto;
  box-sizing: border-box;
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
#pad-root h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
}
#pad-root .muted {
  color: #8b90a0;
  margin: 0;
  font-size: 14px;
}
#pad-root button,
#pad-root input {
  font: inherit;
  color: #f2efe8;
  background: #262a35;
  border: 1px solid #3a3f4d;
  border-radius: 10px;
  padding: 12px 14px;
}
#pad-root input {
  -webkit-user-select: text;
  user-select: text;
  font-size: 18px;
}
#pad-root form input {
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-align: center;
  text-transform: uppercase;
}
#pad-root button:disabled {
  opacity: 0.4;
}
#pad-root button.primary {
  background: #7ed957;
  border-color: #7ed957;
  color: #16181f;
  font-weight: 800;
  font-size: 18px;
  padding: 14px;
}
#pad-root .sides {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
#pad-root .side {
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 2px solid var(--side);
}
#pad-root .side strong {
  color: var(--side);
  font-size: 22px;
}
#pad-root .side.mine {
  background: var(--side);
  color: #16181f;
}
#pad-root .side.mine strong {
  color: #16181f;
}
#pad-root .look-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
}
#pad-root .face {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #3a3f4d;
  display: grid;
  place-items: center;
  font-size: 38px;
}
#pad-root .arrow {
  width: 52px;
}
#pad-root .pad {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr;
  background: radial-gradient(circle at 50% 120%, color-mix(in srgb, var(--player) 22%, transparent), transparent 70%);
  touch-action: none;
}
#pad-root .top {
  grid-column: 1 / 3;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px 0;
}
#pad-root .tag {
  font-weight: 800;
  font-size: 18px;
}
#pad-root .pause {
  padding: 8px 16px;
  font-size: 14px;
}
#pad-root .stick-zone {
  position: relative;
  touch-action: none;
}
#pad-root .zone-label {
  position: absolute;
  left: 50%;
  bottom: 14px;
  transform: translateX(-50%);
  color: #8b90a0;
  font-size: 13px;
  pointer-events: none;
}
#pad-root .stick-base {
  position: absolute;
  left: 50%;
  top: 55%;
  width: ${STICK_RADIUS * 2}px;
  height: ${STICK_RADIUS * 2}px;
  margin: -${STICK_RADIUS}px 0 0 -${STICK_RADIUS}px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.04);
  opacity: 0.5;
  pointer-events: none;
}
#pad-root .stick-base.active {
  opacity: 1;
}
#pad-root .stick-knob {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 56px;
  height: 56px;
  margin: -28px 0 0 -28px;
  border-radius: 50%;
  background: var(--player);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}
#pad-root .buttons {
  position: relative;
  touch-action: none;
}
#pad-root .btn {
  position: absolute;
  border-radius: 50%;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  touch-action: none;
  padding: 0;
}
#pad-root .btn.shoot {
  right: 8%;
  bottom: 14%;
  width: min(36vmin, 170px);
  height: min(36vmin, 170px);
  color: #16181f;
  font-size: 20px;
  border: none;
}
#pad-root .btn.dodge {
  right: calc(8% + min(36vmin, 170px) + 4%);
  bottom: calc(14% + min(18vmin, 85px));
  width: min(26vmin, 120px);
  height: min(26vmin, 120px);
  font-size: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
}
@media (orientation: portrait) {
  #pad-root .btn.dodge {
    right: calc(8% + min(5vmin, 24px));
    bottom: calc(14% + min(36vmin, 170px) + 5vmin);
  }
}
#pad-root .btn.down {
  transform: scale(0.92);
  filter: brightness(1.25);
}
#pad-root .paused {
  position: absolute;
  inset: 60px 0 0;
  display: grid;
  place-items: center;
  font-size: 32px;
  font-weight: 800;
  background: rgba(22, 24, 31, 0.6);
  pointer-events: none;
}
`;
