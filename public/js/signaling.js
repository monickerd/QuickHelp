const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 16000;

export class Signaling {
  constructor(roomId) {
    this.roomId  = roomId;
    this._ws     = null;
    this._closed = false;
    this._retries = 0;

    // Callbacks set by consumers
    this.onPeerJoined = null; // called with the full peer-joined message object
    this.onPeerLeft   = null;
    this._messageHandlers = [];

    this._connect();
  }

  _connect() {
    if (this._closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = `${proto}://${location.host}/ws?room=${this.roomId}`;
    const ws    = new WebSocket(url);
    this._ws    = ws;

    ws.addEventListener('open', () => { this._retries = 0; });

    ws.addEventListener('message', ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'peer-joined') { this.onPeerJoined?.(msg); return; }
      if (msg.type === 'peer-left')   { this.onPeerLeft?.();      return; }
      for (const handler of this._messageHandlers) handler(msg);
    });

    ws.addEventListener('close', () => {
      if (this._closed) return;
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** this._retries, RECONNECT_MAX_MS);
      this._retries++;
      setTimeout(() => this._connect(), delay);
    });
  }

  // Register a handler for incoming non-lifecycle messages. Multiple handlers OK.
  onMessage(handler) {
    this._messageHandlers.push(handler);
  }

  send(msg) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(msg));
    }
  }

  close() {
    this._closed = true;
    this._ws?.close();
  }
}
