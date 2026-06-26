// Matches http(s) URLs. Applied AFTER text nodes are created so no XSS risk.
const URL_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const CHECK_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

// Build a DocumentFragment from text, turning URLs into <a> elements.
// Uses DOM methods throughout — no innerHTML on user content.
function buildContent(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) {
      frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    }
    const a = document.createElement('a');
    a.href        = m[0];
    a.textContent = m[0];
    a.target      = '_blank';
    a.rel         = 'noopener noreferrer';
    frag.appendChild(a);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    frag.appendChild(document.createTextNode(text.slice(last)));
  }
  return frag;
}

export class Chat {
  constructor() {
    this._open   = false;
    this._unread = 0;
    this.onSend  = null; // (text: string) => void

    this._buildDOM();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  toggle() {
    this._open = !this._open;
    this._panel.classList.toggle('chat-open', this._open);
    if (this._open) {
      this._unread = 0;
      this._badge.classList.add('hidden');
      this._badge.textContent = '';
      this._input.focus();
      this._scrollToBottom();
    }
  }

  // isSelf: true if this message was sent by this side
  addMessage(text, isSelf) {
    const row    = document.createElement('div');
    row.className = `chat-msg ${isSelf ? 'chat-msg-self' : 'chat-msg-other'}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.appendChild(buildContent(text));

    const copyBtn = document.createElement('button');
    copyBtn.className = 'chat-copy-btn';
    copyBtn.title     = 'Copy';
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.innerHTML = CHECK_ICON;
        setTimeout(() => { copyBtn.innerHTML = COPY_ICON; }, 1500);
      });
    });

    // Long-press on touch devices to reveal the copy button
    let lpTimer = null;
    bubble.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      lpTimer = setTimeout(() => bubble.classList.add('show-copy'), 600);
    });
    const cancelLp = () => clearTimeout(lpTimer);
    bubble.addEventListener('pointerup',     cancelLp);
    bubble.addEventListener('pointermove',   cancelLp);
    bubble.addEventListener('pointercancel', cancelLp);

    bubble.appendChild(copyBtn);
    row.appendChild(bubble);
    this._list.appendChild(row);

    if (!this._open) {
      this._unread++;
      this._badge.textContent = this._unread > 9 ? '9+' : String(this._unread);
      this._badge.classList.remove('hidden');
    }

    this._scrollToBottom();
  }

  get panel()  { return this._panel; }
  get badge()  { return this._badge; }
  get isOpen() { return this._open; }

  // ── Private ─────────────────────────────────────────────────────────────────

  _buildDOM() {
    this._panel = document.createElement('aside');
    this._panel.className = 'chat-panel';
    this._panel.innerHTML = `
      <div class="chat-header">
        <span>Chat</span>
        <button class="chat-close-btn" aria-label="Close chat">✕</button>
      </div>
      <div class="chat-list"></div>
      <div class="chat-input-row">
        <input type="text" class="chat-input" placeholder="Message…" autocomplete="off" spellcheck="false">
        <button class="btn btn-primary chat-send-btn">Send</button>
      </div>
    `;
    document.body.appendChild(this._panel);

    this._list  = this._panel.querySelector('.chat-list');
    this._input = this._panel.querySelector('.chat-input');

    this._panel.querySelector('.chat-close-btn').addEventListener('click', () => this.toggle());
    this._panel.querySelector('.chat-send-btn').addEventListener('click', () => this._send());
    this._input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
    });

    // Badge is managed externally (lives in the control bar button)
    this._badge = document.createElement('span');
    this._badge.className = 'chat-badge hidden';
  }

  _send() {
    const text = this._input.value.trim();
    if (!text) return;
    this._input.value = '';
    this.onSend?.(text);
  }

  _scrollToBottom() {
    requestAnimationFrame(() => { this._list.scrollTop = this._list.scrollHeight; });
  }
}
