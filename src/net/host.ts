// The desktop side of phone controllers: opens a room on the PeerJS
// signalling server and accepts phones as WebRTC data connections. Once a
// phone is connected its messages go straight to us, on the local network
// when there is one; the signalling server only introduces the two.

import type { DataConnection, Peer } from 'peerjs';
import { makeRoomCode, parsePad, PEER_PREFIX, PhoneRoom, type HostScreen, type RoomEvent } from './protocol';

const ROOM_KEY = 'fpd.room';
// How often we tell each phone what's going on (also sent on any change).
const SEND_EVERY = 0.1; // seconds
// A connection that's gone this long without a message has dropped. WebRTC
// notices on its own too, but can take many seconds.
const TIMEOUT = 3; // seconds

export type HostStatus = 'connecting' | 'ready' | 'offline';

export class PhoneHost {
  readonly room = new PhoneRoom();
  code: string;
  status: HostStatus = 'connecting';
  onEvent: (e: RoomEvent) => void = () => {};

  private started = false;
  private takenTries = 0;
  private conns = new Map<DataConnection, { id: string | null; heardAt: number }>();
  private lastSent = '';
  private sentAt = -Infinity;

  constructor(private clock: () => number) {
    // Keep the same code across a reload of the page, so phones can rejoin.
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(ROOM_KEY);
    } catch {
      // Storage unavailable: a new code each time.
    }
    this.code = saved ?? makeRoomCode();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.open();
  }

  private async open(): Promise<void> {
    this.status = 'connecting';
    let PeerClass: typeof Peer;
    try {
      PeerClass = (await import('peerjs')).Peer;
    } catch {
      // Offline and the library isn't cached yet.
      this.status = 'offline';
      setTimeout(() => void this.open(), 3000);
      return;
    }
    const peer = new PeerClass(PEER_PREFIX + this.code);
    peer.on('open', () => {
      this.status = 'ready';
      this.takenTries = 0;
      try {
        sessionStorage.setItem(ROOM_KEY, this.code);
      } catch {
        // Not saved; the room still works.
      }
    });
    peer.on('connection', (conn) => this.accept(conn));
    // Lost the signalling server: phones already connected keep working, but
    // new ones can't find us until we're back.
    peer.on('disconnected', () => {
      if (peer.destroyed) return;
      this.status = 'offline';
      setTimeout(() => {
        if (!peer.destroyed && peer.disconnected) peer.reconnect();
      }, 2000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Someone has this code, or the server still remembers us from
        // before a reload. Try ours again briefly, then pick another.
        peer.destroy();
        this.takenTries++;
        if (this.takenTries > 3) {
          this.code = makeRoomCode();
          this.takenTries = 0;
        }
        setTimeout(() => void this.open(), 1500);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.status = 'offline';
        if (peer.disconnected && !peer.destroyed) setTimeout(() => peer.reconnect(), 3000);
      } else if (err.type === 'browser-incompatible') {
        this.status = 'offline';
      }
      // Other errors (e.g. one phone's connection failing) don't affect the room.
    });
  }

  private accept(conn: DataConnection): void {
    this.conns.set(conn, { id: null, heardAt: this.clock() });
    conn.on('data', (data) => {
      const info = this.conns.get(conn);
      const pad = parsePad(data);
      if (!info || !pad) return;
      // Only one live connection per phone: a reconnect replaces the old one.
      if (info.id === null) {
        for (const [other, o] of this.conns) if (other !== conn && o.id === pad.id) this.drop(other);
        info.id = pad.id;
      }
      if (info.id !== pad.id) return;
      info.heardAt = this.clock();
      for (const e of this.room.receive(pad, info.heardAt)) this.onEvent(e);
      this.sentAt = -Infinity; // answer right away
    });
    conn.on('close', () => this.drop(conn));
    conn.on('error', () => this.drop(conn));
  }

  private drop(conn: DataConnection): void {
    const info = this.conns.get(conn);
    if (!info) return;
    this.conns.delete(conn);
    conn.close();
    if (info.id !== null) for (const e of this.room.disconnect(info.id)) this.onEvent(e);
  }

  // Something phones should hear about now (like a hit to buzz for).
  nudge(): void {
    this.sentAt = -Infinity;
  }

  // Called every frame: drops silent phones and keeps each phone up to date.
  update(screen: HostScreen, canStart: boolean, colors: readonly string[]): void {
    const now = this.clock();
    for (const [conn, info] of this.conns) if (now - info.heardAt > TIMEOUT) this.drop(conn);
    const summary = `${screen}|${canStart}`;
    if (summary === this.lastSent && now - this.sentAt < SEND_EVERY) return;
    this.lastSent = summary;
    this.sentAt = now;
    for (const [conn, info] of this.conns) {
      if (info.id === null || !conn.open) continue;
      try {
        void conn.send(this.room.messageFor(info.id, screen, canStart, colors));
      } catch {
        // The channel is closing; the timeout will clear it up.
      }
    }
  }
}
