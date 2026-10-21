// Hotseat lobby: add players, see who's up next and the scoreboard, and
// start each match. The session is saved in the browser so a reload doesn't
// lose the evening's scores.

import { KEY_BINDINGS } from '../config';
import { isTextField } from '../input/keyboard';
import {
  addPlayer,
  newSession,
  parseSession,
  recordResult,
  removePlayer,
  resetScores,
  standings,
  updatePlayer,
  upNext,
  type HotseatPlayer,
  type HotseatSession,
} from '../hotseat/session';
import { cycleLook, LOOKS } from '../render/looks';

const SESSION_KEY = 'fpd.hotseat';

export interface HotseatCallbacks {
  onStart(left: HotseatPlayer, right: HotseatPlayer, roundsToWin: number): void;
  onExit(): void;
}

export class HotseatLobby {
  private session: HotseatSession;
  private root: HTMLElement;
  private active = false;
  private openedAt = 0;

  constructor(private callbacks: HotseatCallbacks) {
    this.session = this.load();
    this.root = el('div', { id: 'hotseat', hidden: true });
    document.body.append(this.root);
    window.addEventListener('keydown', (e) => {
      // Ignore the key press that brought us here (e.g. Enter on the results).
      if (!this.active || e.timeStamp < this.openedAt) return;
      if (isTextField(e.target)) {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        this.start();
      } else if (e.key === 'Escape') {
        this.callbacks.onExit();
      }
    });
  }

  open(): void {
    this.active = true;
    this.openedAt = performance.now();
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.active = false;
    this.root.hidden = true;
  }

  // Called when a hotseat match finishes. winnerSide 0 = left keys.
  record(winnerSide: 0 | 1, score: [number, number]): void {
    this.set(recordResult(this.session, winnerSide, score));
  }

  private start(): void {
    const pair = upNext(this.session);
    if (pair) this.callbacks.onStart(pair[0], pair[1], this.session.roundsToWin);
  }

  private set(session: HotseatSession): void {
    this.session = session;
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Scores just won't survive a reload.
    }
    if (this.active) this.render();
  }

  private load(): HotseatSession {
    try {
      return parseSession(JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null'));
    } catch {
      return newSession();
    }
  }

  // A look nobody in the session is using yet, if there is one.
  private freshLook(): string {
    const used = new Set(this.session.players.map((p) => p.look));
    return LOOKS.find((l) => l && !used.has(l)) ?? LOOKS[1 + (this.session.players.length % (LOOKS.length - 1))];
  }

  private render(): void {
    const s = this.session;
    const pair = upNext(s);
    const leader = standings(s).find((p) => p.wins > 0);
    const name = (id: string) => s.players.find((p) => p.id === id)?.name ?? '?';

    const keysHint = (side: 0 | 1) => {
      const k = side === 0 ? KEY_BINDINGS.p1 : KEY_BINDINGS.p2;
      return side === 0
        ? `W A S D · ${keyName(k.shoot)} shoot · ${keyName(k.dodge)} dodge`
        : `Arrows · ${keyName(k.shoot)} shoot · ${keyName(k.dodge)} dodge`;
    };
    const fighter = (p: HotseatPlayer, side: 0 | 1) =>
      el('div', { className: `fighter side-${side}` }, [
        el('div', { className: 'look big', textContent: p.look || '●' }),
        el('div', { className: 'fighter-name', textContent: p.name }),
        el('div', { className: 'keys', textContent: keysHint(side) }),
      ]);

    const upNextCard = pair
      ? el('div', { className: 'up-next' }, [fighter(pair[0], 0), el('div', { className: 'vs', textContent: 'vs' }), fighter(pair[1], 1)])
      : el('div', { className: 'up-next empty', textContent: 'Add at least two players to start.' });

    const last = s.last
      ? el('p', {
          className: 'last',
          textContent:
            `Last match: ${name(s.last.winner)} beat ${name(s.last.loser)} ${s.last.score[0]}–${s.last.score[1]}.` +
            (s.queue.length > 2 ? ` ${name(s.last.loser)} goes to the back of the line.` : ''),
        })
      : null;

    const rows = s.queue.map((id, n) => {
      const p = s.players.find((x) => x.id === id)!;
      const lookBtn = el('button', { className: 'look', type: 'button', textContent: p.look || '●', title: 'Change look' });
      lookBtn.addEventListener('click', () => this.set(updatePlayer(this.session, p.id, { look: cycleLook(p.look) })));
      const nameInput = el('input', { type: 'text', value: p.name, maxLength: 20, ariaLabel: 'Player name' });
      nameInput.addEventListener('change', () => {
        if (nameInput.value.trim()) this.set(updatePlayer(this.session, p.id, { name: nameInput.value.trim() }));
        else nameInput.value = p.name;
      });
      const remove = el('button', { className: 'remove', type: 'button', textContent: '✕', title: `Remove ${p.name}` });
      remove.addEventListener('click', () => this.set(removePlayer(this.session, p.id)));
      const where = n === 0 ? 'Left keys' : n === 1 ? 'Right keys' : `${n - 1}${ordinal(n - 1)} in line`;
      return el('tr', { className: n < 2 ? 'playing' : '' }, [
        el('td', { className: 'where', textContent: where }),
        el('td', {}, [lookBtn]),
        el('td', { className: 'name' }, [nameInput, ...(leader?.id === p.id ? [el('span', { className: 'crown', textContent: ' 🏆', title: 'Leader' })] : [])]),
        el('td', { className: 'num', textContent: String(p.wins) }),
        el('td', { className: 'num', textContent: String(p.losses) }),
        el('td', { className: 'num', textContent: String(p.bestStreak) }),
        el('td', {}, [remove]),
      ]);
    });

    const table = el('table', {}, [
      el('thead', {}, [
        el('tr', {}, ['', '', 'Player', 'Won', 'Lost', 'Best streak', ''].map((h) => el('th', { textContent: h }))),
      ]),
      el('tbody', {}, rows),
    ]);

    // Add a player.
    let addLook = this.freshLook();
    const addLookBtn = el('button', { className: 'look', type: 'button', textContent: addLook, title: 'Change look' });
    addLookBtn.addEventListener('click', () => {
      addLook = cycleLook(addLook) || cycleLook('');
      addLookBtn.textContent = addLook;
    });
    const addInput = el('input', { type: 'text', placeholder: 'Add a player…', maxLength: 20, ariaLabel: 'New player name' });
    const add = () => {
      if (!addInput.value.trim()) return;
      this.set(addPlayer(this.session, addInput.value, addLook, `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`));
      (this.root.querySelector('.add input') as HTMLInputElement | null)?.focus();
    };
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        add();
      }
    });
    const addBtn = el('button', { type: 'button', textContent: 'Add' });
    addBtn.addEventListener('click', add);

    // Match length.
    const lengths = el(
      'div',
      { className: 'lengths' },
      [el('span', { textContent: 'Each match: first to' }), ...[1, 2, 3].map((n) => {
        const b = el('button', { type: 'button', textContent: String(n), className: s.roundsToWin === n ? 'on' : '' });
        b.addEventListener('click', () => this.set({ ...this.session, roundsToWin: n }));
        return b;
      }), el('span', { textContent: s.roundsToWin === 1 ? 'round' : 'rounds' })],
    );

    const startBtn = el('button', { className: 'primary', type: 'button', textContent: 'Start match ▶', disabled: !pair });
    startBtn.addEventListener('click', () => this.start());
    const resetBtn = el('button', { type: 'button', textContent: 'Reset scores' });
    resetBtn.addEventListener('click', () => {
      if (confirm("Reset everyone's wins and losses?")) this.set(resetScores(this.session));
    });
    const backBtn = el('button', { type: 'button', textContent: 'Back' });
    backBtn.addEventListener('click', () => this.callbacks.onExit());

    this.root.replaceChildren(
      el('div', { className: 'panel' }, [
        el('h1', { textContent: 'Hotseat' }),
        el('p', { className: 'sub', textContent: 'Winner stays on. The loser goes to the back of the line and the next player takes their keys.' }),
        upNextCard,
        ...(last ? [last] : []),
        table,
        el('div', { className: 'add' }, [addLookBtn, addInput, addBtn]),
        lengths,
        el('div', { className: 'actions' }, [startBtn, resetBtn, backBtn]),
        el('p', { className: 'hint', textContent: 'Enter to start · Esc to go back · click a look to change it' }),
      ]),
    );
  }
}

function keyName(code: string): string {
  return ({ Comma: ',', Period: '.', Slash: '/' } as Record<string, string>)[code] ?? code.replace('Key', '');
}

function ordinal(n: number): string {
  return n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
