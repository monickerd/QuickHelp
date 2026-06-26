export class Capture {
  constructor() {
    this._micTrack     = null;
    this._screenTrack  = null;
    this._screenStream = null;
  }

  // Request mic permission and return the track (null if denied)
  async startMic() {
    if (this._micTrack) return this._micTrack;
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this._micTrack = stream.getAudioTracks()[0] ?? null;
    } catch {
      this._micTrack = null;
    }
    return this._micTrack;
  }

  // Request screen capture and return the video track
  async startScreen() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        frameRate: { ideal: 30, max: 30 },
        width:     { ideal: 1920 },
        height:    { ideal: 1080 },
        cursor:    'always',
      },
      audio: false,
    });
    this._screenStream = stream;
    this._screenTrack  = stream.getVideoTracks()[0];
    return this._screenTrack;
  }

  stopScreen() {
    this._screenStream?.getTracks().forEach(t => t.stop());
    this._screenTrack  = null;
    this._screenStream = null;
  }

  setMicEnabled(enabled) {
    if (this._micTrack) this._micTrack.enabled = enabled;
  }

  stopAll() {
    this.stopScreen();
    this._micTrack?.stop();
    this._micTrack = null;
  }

  get isScreenSharing() { return !!this._screenTrack; }
  get screenStream()    { return this._screenStream; }
  get micTrack()        { return this._micTrack; }
}
