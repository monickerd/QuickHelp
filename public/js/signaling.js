const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 16000;

// A stable per-tab identity for this room. Survives reloads (sessionStorage)
// so the server can hand this client its old slot back instead of rejecting it
// as a third participant while the dropped socket is still being cleaned up.
function getClientId(roomId) {
  const key = `clientId:${roomId}`;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    sessionStorage.setItem(key, id);
  }
  return id;
}

export class Signaling {
  constructor(roomId) {
    this.roomId   = roomId;
    this.clientId = getClientId(roomId);
    this._ws      = null;
    this._closed  = false;
    this._retries = 0;
    this._wasOpen = false; // have we ever connected? distinguishes first connect from reconnect

    // Callbacks set by consumers
    this.onPeerJoined   = null; // called with the full peer-joined message object
    this.onPeerLeft     = null;
    this.onReconnecting = null; // socket dropped, a retry is scheduled
    this.onReconnected  = null; // socket came back after having dropped
    this._messageHandlers = [];

    this._connect();
  }

  _connect() {
    if (this._closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url   = `${proto}://${location.host}/ws?room=${this.roomId}&id=${this.clientId}`;
    const ws    = new WebSocket(url);
    this._ws    = ws;

    ws.addEventListener('open', () => {
      this._retries = 0;
      if (this._wasOpen) this.onReconnected?.();
      this._wasOpen = true;
    });

    ws.addEventListener('message', ({ data }) => {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }

      if (msg.type === 'peer-joined') { this.onPeerJoined?.(msg); return; }
      if (msg.type === 'peer-left')   { this.onPeerLeft?.();      return; }
      for (const handler of this._messageHandlers) handler(msg);
    });

    ws.addEventListener('close', () => {
      if (this._closed) return;
      this.onReconnecting?.();
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** this._retries, RECONNECT_MAX_MS);
      this._retries++;
      setTimeout(() => this._connect(), delay);
    });
  }

  // Register a handler for incoming non-lifecycle messages. Multiple handlers OK.
  onMessage(handler) {
    this._messageHandlers.push(handler);
  }

  get isOpen() { return this._ws?.readyState === WebSocket.OPEN; }

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
