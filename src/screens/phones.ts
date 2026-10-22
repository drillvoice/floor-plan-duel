// Phone lobby: a room code and QR code for phones to join, and which phone
// holds each of the four seats. Phones stay connected after leaving this screen, so
// they can go straight back in for a rematch.

import qrcode from 'qrcode-generator';
import { isTextField } from '../input/keyboard';
import { joinUrl } from '../net/protocol';
import type { PhoneHost } from '../net/host';
import type { PlayerIndex } from '../sim/types';
import { el } from './dom';

export interface PhoneLobbyCallbacks {
  onStart(): void;
  onExit(): void;
  // Who plays a seat with no phone: "Human (keyboard)", "Bot · Normal", or
  // null when nobody does (P3 and P4 can be empty).
  fallback(slot: PlayerIndex): string | null;
  colors: readonly string[];
}

export class PhoneLobby {
  private root: HTMLElement;
  private active = false;
  private openedAt = 0;
  private shown = '';
  private timer = 0;

  constructor(
    private host: PhoneHost,
    private callbacks: PhoneLobbyCallbacks,
  ) {
    this.root = el('div', { id: 'phones', hidden: true });
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      if (!this.active || e.timeStamp < this.openedAt || isTextField(e.target)) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.callbacks.onStart();
      } else if (e.key === 'Escape') {
        this.callbacks.onExit();
      }
    });
  }

  open(): void {
    this.host.start();
    this.active = true;
    this.openedAt = performance.now();
    this.root.hidden = false;
    this.shown = '';
    this.render();
    // Phones come and go on their own, so keep the screen current.
    this.timer = window.setInterval(() => this.render(), 250);
  }

  close(): void {
    this.active = false;
    this.root.hidden = true;
    clearInterval(this.timer);
  }

  private render(): void {
    const { host } = this;
    const url = joinUrl(location.href, host.code);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const seats = this.callbacks.colors.map((_, i) => {
      const phone = host.room.phoneIn(i);
      if (phone) return { icon: phone.look || '📱', name: phone.name || `Phone ${i + 1}`, note: 'Phone connected' };
      if (host.room.isWaitingFor(i)) return { icon: '📱', name: 'Reconnecting…', note: 'Waiting for the phone to come back' };
      const fallback = this.callbacks.fallback(i);
      return { icon: '', name: 'No phone yet', note: fallback ? `Plays as ${fallback}` : 'Empty until a phone joins' };
    });
    // Rebuild only when something visible changed (keeps the QR code steady).
    const key = JSON.stringify([host.status, url, local, seats]);
    if (key === this.shown) return;
    this.shown = key;

    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const qrBox = el('div', { className: 'qr' });
    qrBox.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });

    const status =
      host.status === 'ready'
        ? 'Scan with a phone camera, or open the link and type the code.'
        : host.status === 'connecting'
          ? 'Opening the room…'
          : "Can't reach the room server. Check the internet connection; retrying…";

    const seatCards = seats.map((s, i) => {
      const color = this.callbacks.colors[i];
      const look = el('div', { className: 'look big', textContent: s.icon });
      look.style.background = color;
      const name = el('div', { className: 'seat-name', textContent: s.name });
      name.style.color = color;
      return el('div', { className: `seat${host.room.phoneIn(i) ? ' joined' : ''}` }, [
        look,
        name,
        el('div', { className: 'seat-note', textContent: `P${i + 1} · ${s.note}` }),
      ]);
    });

    const startBtn = el('button', { className: 'primary', type: 'button', textContent: 'Start match ▶' });
    startBtn.addEventListener('click', () => this.callbacks.onStart());
    const backBtn = el('button', { type: 'button', textContent: 'Back' });
    backBtn.addEventListener('click', () => this.callbacks.onExit());

    this.root.replaceChildren(
      el('div', { className: 'panel' }, [
        el('h1', { textContent: 'Phone controllers' }),
        el('p', { className: 'sub', textContent: 'Up to four players join on their phones and get a joystick with Dodge and Shoot buttons.' }),
        el('div', { className: 'join' }, [
          qrBox,
          el('div', { className: 'join-text' }, [
            el('div', { className: 'code-label', textContent: 'Room code' }),
            el('div', { className: `code${host.status === 'ready' ? '' : ' dim'}`, textContent: host.code }),
            el('a', { className: 'url', href: url, target: '_blank', textContent: url }),
            el('p', { className: `status ${host.status}`, textContent: status }),
            ...(local
              ? [el('p', { className: 'warn', textContent: "Phones can't open localhost. Run `npm run dev -- --host` and open the network address on this computer, or use the deployed site." })]
              : []),
          ]),
        ]),
        el('div', { className: 'seats' }, seatCards),
        el('div', { className: 'actions' }, [startBtn, backBtn]),
        el('p', { className: 'hint', textContent: 'Enter (or Start on a phone) to play · Esc to go back · phones stay connected between matches' }),
      ]),
    );
  }
}
