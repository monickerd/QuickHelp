const RING_COUNT  = 3;
const RING_DELAY  = 150;  // ms between each ring
const RING_DURATION = 700; // ms per ring animation

export class Cursor {
  constructor(el) {
    this._el        = el;
    this._hideTimer = null;
  }

  // x, y are normalized 0..1 coordinates relative to the client's full viewport
  update(x, y) {
    const px = x * window.innerWidth;
    const py = y * window.innerHeight;

    this._el.style.left    = `${px}px`;
    this._el.style.top     = `${py}px`;
    this._el.style.display = 'block';

    clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => this.hide(), 3000);
  }

  showClick(x, y) {
    const px = x * window.innerWidth;
    const py = y * window.innerHeight;

    for (let i = 0; i < RING_COUNT; i++) {
      const ring = document.createElement('div');
      ring.className = 'click-ring';
      ring.style.left             = `${px}px`;
      ring.style.top              = `${py}px`;
      ring.style.animationDelay   = `${i * RING_DELAY}ms`;
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), RING_DURATION + i * RING_DELAY + 50);
    }
  }

  hide() {
    this._el.style.display = 'none';
    clearTimeout(this._hideTimer);
  }
}
