// In-game chat. A real (visually hidden) text field holds what is typed, so
// paste, IME composition, mobile keyboards and caret keys all just work; the
// canvas draws the visible box and the message history.
const CHAT = {
  maxMessages: 10,
  maxLen: 80,
  lineH: 18,
  font: '13px monospace',
  boxX: 50,           // clear of the ⚙ button in the bottom-left corner
  boxW: 340,
  boxH: 24,
  bottom: 12,
  showSec: 5,         // fully visible, then fades out over the same time
};

class ChatManager {
  static getInstance() {
    return ChatManager.instance || (ChatManager.instance = new ChatManager());
  }

  constructor() {
    this.messages = [];             // [{ name, text, hue, system, timestamp }]
    this.maxMessages = CHAT.maxMessages;
    this.isOpen = false;
    this._el = this._createField();
    this._chips = this._createChips();
  }

  _createField() {
    const el = Object.assign(document.createElement('input'), {
      type: 'text', maxLength: CHAT.maxLen, autocomplete: 'off', spellcheck: false,
      className: 'chat-input', tabIndex: -1,
    });
    el.setAttribute('aria-label', 'Chat message');
    el.setAttribute('enterkeyhint', 'send');
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();                    // the game must not see these keys
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        this._send(this.close());
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    el.addEventListener('keyup', e => e.stopPropagation());
    el.addEventListener('blur', () => { if (this.isOpen) this.close(); });
    document.body.appendChild(el);
    return el;
  }

  // Touch quick-chat: one tap sends a phrase. pointerdown + preventDefault
  // keeps the field focused so it doesn't close first.
  _createChips() {
    const box = document.createElement('div');
    box.className = 'quick-chat';
    box.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      this.close();
      this._send(btn.textContent);
    });
    document.body.appendChild(box);
    return box;
  }

  _send(text) {
    if (typeof submitChat === 'function') submitChat(text);
  }

  _renderChips() {
    this._chips.replaceChildren(...t('chat.quick').split('|').map((phrase) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = phrase;
      return b;
    }));
  }

  get input() { return this._el.value; }

  open() {
    const touch = typeof inputMode !== 'undefined' && inputMode.mode === 'touch';
    this.isOpen = true;
    this._el.value = '';
    document.body.classList.toggle('touch-chat', touch);
    if (touch) this._renderChips();
    this._el.placeholder = touch ? '…' : '';
    if (typeof onBlurHandler === 'function') onBlurHandler();   // let go of held keys
    this._el.focus({ preventScroll: true });
  }

  // Closes the line and returns what was typed (trimmed, maybe empty).
  close() {
    const text = this._el.value.trim();
    this.isOpen = false;
    this._el.value = '';
    this._el.blur();
    document.body.classList.remove('touch-chat');
    return text;
  }

  // Names muted on this device (lower case), kept in localStorage.
  get muted() {
    if (!this._muted) {
      try { this._muted = new Set(JSON.parse(localStorage.getItem('sar_muted') || '[]')); } catch (e) { this._muted = new Set(); }
    }
    return this._muted;
  }

  setMuted(name, on) {
    const key = String(name).trim().toLowerCase();
    if (!key) return false;
    this.muted[on ? 'add' : 'delete'](key);
    try { localStorage.setItem('sar_muted', JSON.stringify([...this.muted])); } catch (e) {}
    return true;
  }

  addMessage(name, text, hue = null) {
    if (name && this.muted.has(String(name).toLowerCase())) return;
    const fromServer = name === 'Server' || name === '[Admin]';
    // The server speaks English: its lines are translated here.
    if (fromServer && typeof i18n !== 'undefined') {
      text = i18n.chat(text);
      if (name === 'Server') name = t('chat.server');
    }
    this.messages.push({ name, text, hue, system: fromServer || name === '?', timestamp: Date.now() });
    if (this.messages.length > this.maxMessages) this.messages.shift();
  }

  draw(ctx, canvas) {
    if (!this.messages.length && !this.isOpen) return;
    ctx.save();
    const touch = document.body.classList.contains('touch-ui');
    let x = CHAT.boxX, y0;
    if (touch) {
      // The move stick owns the bottom-left on touch: messages go under the
      // top toolbar, and typing happens in the on-screen field.
      hudTransform(ctx, 0, 0);
      const cssPerUnit = (canvas.clientHeight / display.viewH) * (display.uiScale || 1);
      x = 12 / cssPerUnit;
      y0 = Math.max(0, 106 - canvas.getBoundingClientRect().top) / cssPerUnit + 12;
    } else {
      hudTransform(ctx, 0, VIEW_H);           // grows from the bottom-left on phones
      y0 = VIEW_H - CHAT.bottom - (this.isOpen ? CHAT.boxH : 0) - this.messages.length * CHAT.lineH;
    }
    this.messages.forEach((m, i) => this._drawMessage(ctx, m, x, y0 + i * CHAT.lineH));
    if (this.isOpen && !touch) this._drawInputBox(ctx);
    ctx.restore();
  }

  _drawMessage(ctx, msg, x, y) {
    const age = (Date.now() - msg.timestamp) / 1000;
    const alpha = this.isOpen ? 1 : Math.max(0, 1 - (age - CHAT.showSec) / CHAT.showSec);
    if (alpha <= 0) return;
    const mine = !msg.system && typeof playerManager !== 'undefined' && playerManager.mainPlayer?.name === msg.name;
    const label = `${mine ? t('hud.you') : msg.name}: `;
    // Name in the colour of the sender's spinner (the tint shifts hue by ~36°).
    const nameColor = msg.hue != null ? `hsla(${(msg.hue + 36) % 360},80%,65%,${alpha})` : `rgba(255,255,255,${alpha})`;
    ctx.font = CHAT.font;
    ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
    ctx.fillText(`${label}${msg.text}`, x + 1, y + 1);
    ctx.fillStyle = nameColor;
    ctx.fillText(label, x, y);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText(msg.text, x + ctx.measureText(label).width, y);
  }

  // Text scrolled so the caret stays in view, plus a blinking caret.
  _drawInputBox(ctx) {
    const { boxX: bx, boxW, boxH } = CHAT;
    const by = VIEW_H - CHAT.bottom - boxH;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(bx - 4, by, boxW, boxH);
    ctx.strokeStyle = '#4a6fa5';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 4, by, boxW, boxH);
    ctx.font = CHAT.font;
    ctx.fillStyle = 'white';
    const text = this.input;
    const inner = boxW - 10;
    const caretX = ctx.measureText(text.slice(0, this._el.selectionStart ?? text.length)).width;
    const scroll = Math.max(0, caretX - inner);
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx - 2, by, inner + 6, boxH);
    ctx.clip();
    ctx.fillText(text, bx + 2 - scroll, by + 16);
    if (Math.floor(Date.now() / 500) % 2 === 0) ctx.fillRect(bx + 2 - scroll + caretX, by + 5, 1.5, 14);
    ctx.restore();
  }
}

const chatManager = ChatManager.getInstance();
