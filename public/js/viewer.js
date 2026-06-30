const TAP_MAX_MOVE_PX    = 12;   // max finger travel to count as a tap
const TAP_MAX_MS         = 300;  // max duration to count as a tap
const DOUBLE_TAP_MAX_MS  = 400;  // window between taps for double-tap
const ZOOM_MIN           = 1;
const ZOOM_MAX           = 5;

export class Viewer {
  constructor(videoEl, peer) {
    this._video    = videoEl;
    this._peer     = peer;
    this._lastSend = 0;
    this._container = null;
    this._zoomEl    = null;

    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;

    // Per-touch: id → { startX, startY, curX, curY, prevX, prevY }
    this._touches   = new Map();
    this._peakCount = 0;
    this._gestureMs = 0;
    this._lastTapMs = 0;
    this._pinchDist = 0;
    this._pinchMidX = 0;
    this._pinchMidY = 0;

    // Optional callback: (zoom: number) => void
    this.onZoomChange = null;
  }

  startCursorTracking(container) {
    this._container = container;

    // Wrap the video in a zoom container so transforms don't affect the
    // waiting overlay or other siblings in viewer-body
    const zoomEl = document.createElement('div');
    zoomEl.className = 'zoom-container';
    this._video.parentNode.insertBefore(zoomEl, this._video);
    zoomEl.appendChild(this._video);
    this._zoomEl = zoomEl;

    container.addEventListener('touchstart',  this._onTouchStart.bind(this),  { passive: true });
    container.addEventListener('touchmove',   this._onTouchMove.bind(this),   { passive: true });
    container.addEventListener('touchend',    this._onTouchEnd.bind(this),    { passive: true });
    container.addEventListener('touchcancel', this._onTouchCancel.bind(this), { passive: true });
  }

  resetZoom() {
    this._zoom = 1;
    this._panX = 0;
    this._panY = 0;
    this._applyTransform();
  }

  // ── Touch ─────────────────────────────────────────────────────────────────

  _onTouchStart(e) {
    if (this._touches.size === 0) {
      this._gestureMs = performance.now();
      this._peakCount = 0;
    }

    for (const t of e.changedTouches) {
      this._touches.set(t.identifier, {
        startX: t.clientX, startY: t.clientY,
        curX:   t.clientX, curY:   t.clientY,
        prevX:  t.clientX, prevY:  t.clientY,
      });
    }

    this._peakCount = Math.max(this._peakCount, this._touches.size);
  }

  _onTouchMove(e) {
    for (const t of e.changedTouches) {
      const rec = this._touches.get(t.identifier);
      if (rec) { rec.curX = t.clientX; rec.curY = t.clientY; }
    }

    const pts = [...this._touches.values()];

    if (pts.length >= 2) {
      this._handlePinch(pts[0], pts[1]);
    } else if (pts.length === 1) {
      this._handleSingleMove(pts[0]);
    }

    // Advance prevX/prevY after handling so next move gets the delta
    for (const t of e.changedTouches) {
      const rec = this._touches.get(t.identifier);
      if (rec) { rec.prevX = rec.curX; rec.prevY = rec.curY; }
    }
  }

  _handlePinch(a, b) {
    const midX = (a.curX + b.curX) / 2;
    const midY = (a.curY + b.curY) / 2;
    const dist = Math.hypot(b.curX - a.curX, b.curY - a.curY);

    if (this._pinchDist > 0) {
      const scaleRatio = dist / this._pinchDist;
      const newZoom    = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this._zoom * scaleRatio));

      // Zoom around the pinch midpoint so the point under the fingers stays fixed
      const rect      = this._container.getBoundingClientRect();
      const cx        = rect.width  / 2;
      const cy        = rect.height / 2;
      const localMidX = midX - rect.left;
      const localMidY = midY - rect.top;

      const contentX = (localMidX - cx - this._panX) / this._zoom;
      const contentY = (localMidY - cy - this._panY) / this._zoom;
      this._panX = localMidX - cx - contentX * newZoom;
      this._panY = localMidY - cy - contentY * newZoom;
      this._zoom = newZoom;

      // Also pan by however much the midpoint itself moved
      this._panX += localMidX - (this._pinchMidX - rect.left);
      this._panY += localMidY - (this._pinchMidY - rect.top);

      this._applyTransform();
    }

    this._pinchDist = dist;
    this._pinchMidX = midX;
    this._pinchMidY = midY;
  }

  _handleSingleMove(t) {
    if (this._zoom > 1) {
      this._panX += t.curX - t.prevX;
      this._panY += t.curY - t.prevY;
      this._applyTransform();
    }
  }

  _onTouchEnd(e) {
    let lastRec;
    for (const t of e.changedTouches) {
      lastRec = this._touches.get(t.identifier);
      this._touches.delete(t.identifier);
    }

    // Reset pinch tracking once we drop below two fingers
    if (this._touches.size < 2) {
      this._pinchDist = 0;
      this._pinchMidX = 0;
      this._pinchMidY = 0;
    }

    if (this._touches.size === 0 && lastRec) {
      const elapsed  = performance.now() - this._gestureMs;
      const movement = Math.hypot(lastRec.curX - lastRec.startX, lastRec.curY - lastRec.startY);
      const isTap    = this._peakCount === 1
                    && elapsed  < TAP_MAX_MS
                    && movement < TAP_MAX_MOVE_PX;

      if (isTap) {
        const now = performance.now();
        if (now - this._lastTapMs < DOUBLE_TAP_MAX_MS) {
          this._lastTapMs = 0;
          this.resetZoom();
        } else {
          this._lastTapMs = now;
        }
      }
    }
  }

  _onTouchCancel(e) {
    for (const t of e.changedTouches) this._touches.delete(t.identifier);
    this._pinchDist = 0;
  }

  // ── Zoom helpers ──────────────────────────────────────────────────────────

  _applyTransform() {
    const W    = this._container.clientWidth;
    const H    = this._container.clientHeight;
    // Clamp pan so you can't scroll past the edges of the zoomed content
    const maxX = (this._zoom - 1) * W / 2;
    const maxY = (this._zoom - 1) * H / 2;
    this._panX = Math.max(-maxX, Math.min(maxX, this._panX));
    this._panY = Math.max(-maxY, Math.min(maxY, this._panY));
    this._zoomEl.style.transform =
      `translate(${this._panX}px, ${this._panY}px) scale(${this._zoom})`;
    this.onZoomChange?.(this._zoom);
  }

}
