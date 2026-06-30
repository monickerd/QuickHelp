// Connection recovery ladder.
//
// Drives an automatic, escalating response to a broken peer connection so the
// user never has to manually reconnect or re-share:
//
//   1. disconnected  → short grace period (ICE often self-heals)
//   2. still broken  → ICE restart        (offerer only; keeps tracks)
//   3. still broken  → full restart       (server-coordinated peer.reset on both)
//   4. exhausted     → surface a specific error on both sides
//
// A media watchdog covers the "connected but no frames arriving" case, which
// connectionState alone doesn't catch, and feeds it into the same ladder.

const DISCONNECT_GRACE_MS = 4000;   // let ICE try to recover on its own first
const ATTEMPT_TIMEOUT_MS  = 9000;   // how long to wait for one step to reach 'connected'
const MAX_FULL_RESTARTS   = 2;      // server-coordinated renegotiations before giving up
const SIGNALING_DOWN_MS   = 20000;  // websocket unreachable this long → signaling error
const MEDIA_POLL_MS       = 2000;
const MEDIA_STALL_MS      = 8000;   // remote is sharing but no new frames for this long

const REASON_MESSAGES = {
  signaling:  "Can't reach the server. Retrying… check your internet connection.",
  negotiation: "Couldn't establish a connection to the other person. A firewall or NAT may be blocking it (a TURN server is often required).",
  media:      "Connected, but no video is coming through — the stream stalled and couldn't recover.",
  connection: "Connection lost and couldn't be recovered automatically.",
};

export class Recovery {
  // hooks: { onStatus(text), onError(reason, message), onClearError(),
  //          requestRestart(), notifyPeerFailed(reason) }
  constructor(peer, hooks) {
    this._peer  = peer;
    this._hooks = hooks;

    this._isOfferer    = false;
    this._phase        = 'idle';  // 'idle' | 'recovering' | 'failed'
    this._step         = 0;       // index into the current recovery plan
    this._reason       = 'connection';

    this._graceTimer   = null;
    this._attemptTimer = null;
    this._sigTimer     = null;

    // Media watchdog
    this._expectMedia  = false;
    this._lastFrames   = 0;
    this._lastAdvance  = 0;
    this._mediaTimer   = setInterval(() => this._pollMedia(), MEDIA_POLL_MS);
  }

  // ── External signals ───────────────────────────────────────────────────────

  setRole(isOfferer) { this._isOfferer = isOfferer; }

  // Called on every RTCPeerConnection connectionstatechange.
  handleConnectionState(state) {
    if (state === 'connected') { this._onConnected(); return; }

    // While a recovery attempt is in flight, the attempt timer governs the
    // cadence — ignore the intermediate failed/disconnected churn it produces.
    if (this._phase !== 'idle') return;

    if (state === 'failed') {
      this._beginRecovery('connection');
    } else if (state === 'disconnected') {
      clearTimeout(this._graceTimer);
      this._graceTimer = setTimeout(() => {
        if (this._peer.connectionState !== 'connected') this._beginRecovery('connection');
      }, DISCONNECT_GRACE_MS);
    }
  }

  // Remote screen-share started/stopped — arms or disarms the media watchdog.
  noteRemoteSharing(sharing) {
    this._expectMedia = sharing;
    this._lastFrames  = 0;
    this._lastAdvance = performance.now(); // grace before first frames are expected
  }

  // Websocket dropped / recovered (from Signaling callbacks).
  noteSignalingDown() {
    if (this._sigTimer) return;
    this._sigTimer = setTimeout(() => this._fail('signaling'), SIGNALING_DOWN_MS);
  }
  noteSignalingUp() {
    clearTimeout(this._sigTimer);
    this._sigTimer = null;
    if (this._reason === 'signaling') this._hooks.onClearError?.();
  }

  // User clicked "Retry" on the error banner — go straight to a coordinated
  // full restart (skip the grace/ICE/wait steps; they've already been tried).
  manualRetry() {
    this._reset();
    this._hooks.onClearError?.();
    this._phase  = 'recovering';
    this._reason = 'connection';
    this._step   = 1; // index 1 of either plan is the first 'full' restart
    this._escalate();
  }

  // The other side reported it gave up (relayed 'session-failed').
  handleRemoteFailure(reason) {
    this._phase  = 'failed';
    this._reason = reason || 'connection';
    this._clearTimers();
    this._hooks.onError?.(this._reason, REASON_MESSAGES[this._reason] ?? REASON_MESSAGES.connection);
  }

  destroy() {
    clearInterval(this._mediaTimer);
    this._clearTimers();
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _onConnected() {
    this._reset();
    this._hooks.onClearError?.();
  }

  _reset() {
    this._phase = 'idle';
    this._step  = 0;
    this._clearTimers();
  }

  _clearTimers() {
    clearTimeout(this._graceTimer);   this._graceTimer   = null;
    clearTimeout(this._attemptTimer); this._attemptTimer = null;
  }

  _beginRecovery(reason) {
    if (this._phase === 'recovering') return;
    this._phase  = 'recovering';
    this._reason = reason;
    this._step   = 0;
    this._escalate();
  }

  // The ladder, by role. The offerer can do a cheap ICE restart; the
  // non-offerer instead waits one cycle to give the offerer's restart a chance
  // before asking the server to coordinate a full restart.
  _plan() {
    const fulls = Array(MAX_FULL_RESTARTS).fill('full');
    return this._isOfferer ? ['ice', ...fulls, 'fail'] : ['wait', ...fulls, 'fail'];
  }

  _escalate() {
    clearTimeout(this._attemptTimer);
    if (this._peer.connectionState === 'connected') { this._onConnected(); return; }

    const plan   = this._plan();
    const action = plan[Math.min(this._step, plan.length - 1)];
    this._step++;

    switch (action) {
      case 'ice':
        this._hooks.onStatus?.('Reconnecting…');
        this._peer.restartIce().catch(() => {});
        break;
      case 'wait':
        this._hooks.onStatus?.('Reconnecting…');
        break;
      case 'full':
        this._hooks.onStatus?.('Reconnecting…');
        this._hooks.requestRestart?.();
        break;
      case 'fail':
        this._fail(this._reason);
        return;
    }

    this._attemptTimer = setTimeout(() => {
      if (this._peer.connectionState === 'connected') this._onConnected();
      else this._escalate();
    }, ATTEMPT_TIMEOUT_MS);
  }

  _fail(reason) {
    this._phase  = 'failed';
    this._reason = reason;
    this._clearTimers();
    const message = REASON_MESSAGES[reason] ?? REASON_MESSAGES.connection;
    this._hooks.onError?.(reason, message);
    // Tell the other side too, so the error shows on both. 'signaling' failures
    // can't be relayed (the socket is what's down) — the peer will detect it
    // independently via its own ladder.
    if (reason !== 'signaling') this._hooks.notifyPeerFailed?.(reason);
  }

  async _pollMedia() {
    if (!this._expectMedia || this._phase !== 'idle') return;
    if (this._peer.connectionState !== 'connected') return;

    const pc = this._peer.peerConnection;
    if (!pc) return;

    let frames = null;
    try {
      const stats = await pc.getStats();
      stats.forEach(r => {
        if (r.type === 'inbound-rtp' && r.kind === 'video' && r.framesReceived != null) {
          frames = r.framesReceived;
        }
      });
    } catch { return; }
    if (frames == null) return;

    const now = performance.now();
    if (frames > this._lastFrames) {
      this._lastFrames  = frames;
      this._lastAdvance = now;
    } else if (now - this._lastAdvance > MEDIA_STALL_MS) {
      this._beginRecovery('media');
    }
  }
}
