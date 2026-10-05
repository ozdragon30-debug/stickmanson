class ChatManager {
  static getInstance() {
    if (!ChatManager.instance) {
      ChatManager.instance = new ChatManager();
    }
    return ChatManager.instance;
  }

  constructor() {
    this.messages  = [];   // [{ name, text, timestamp }]
    this.maxMessages = 10;
    this.isOpen    = false;

    // A real (visually hidden) text field backs the chat line, so paste, IME
    // composition (e.g. Turkish/CJK input), mobile keyboards and caret
    // movement all work. The canvas still draws the visible chat box.
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = 80;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('aria-label', 'Chat message');
    el.setAttribute('enterkeyhint', 'send');
    el.className = 'chat-input';
    el.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const text = this.close();
        if (typeof submitChat === 'function') submitChat(text);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    el.addEventListener('keyup', e => e.stopPropagation());
    el.addEventListener('blur', () => { if (this.isOpen) this.close(); });
    document.body.appendChild(el);
    this._el = el;

    // Quick-chat chips (touch only): one tap sends a phrase.
    const chips = document.createElement('div');
    chips.className = 'quick-chat';
    // pointerdown + preventDefault keeps the text field focused (no blur/close).
    chips.addEventListener('pointerdown', e => {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      this.close();
      if (typeof submitChat === 'function') submitChat(b.textContent);
    });
    document.body.appendChild(chips);
    this._chips = chips;
  }

  _renderChips() {
    const phrases = t('chat.quick').split('|');
    this._chips.innerHTML = '';
    for (const p of phrases) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p;
      this._chips.appendChild(b);
    }
  }

  get input() { return this._el.value; }

  open() {
    this.isOpen = true;
    this._el.value = '';
    const touch = typeof inputMode !== 'undefined' && inputMode.mode === 'touch';
    document.body.classList.toggle('touch-chat', touch);
    if (touch) this._renderChips();
    this._el.placeholder = touch ? '…' : '';
    if (typeof onBlurHandler === 'function') onBlurHandler(); // release held movement keys
    this._el.focus({ preventScroll: true });
  }

  // Returns the message text (may be empty), then closes.
  close() {
    const text = this._el.value.trim();
    this.isOpen = false;
    this._el.value = '';
    this._el.blur();
    document.body.classList.remove('touch-chat');
    return text;
  }

  addMessage(name, text, hue = null) {
    // System lines from the (English) server are translated client-side.
    if ((name === 'Server' || name === '[Admin]') && typeof i18n !== 'undefined') {
      text = i18n.chat(text);
      if (name === 'Server') name = t('chat.server');
    }
    this.messages.push({ name, text, hue, timestamp: Date.now() });
    if (this.messages.length > this.maxMessages) {
      this.messages.shift();
    }
  }

  draw(ctx, canvas) {
    if (!this.messages.length && !this.isOpen) return;

    ctx.save();
    resetScreenTransform(ctx);

    const x      = 50;   // aligned with the input box, clear of the ⚙ button
    const lineH  = 18;
    const msgFontSize = 13;
    const inputH = this.isOpen ? 24 : 0;
    const bottomPad = 12;
    // Chat input box starts further right to avoid overlapping the gear button in the lower-left corner.
    const inputX = 50;
    const baseY  = VIEW_H - bottomPad - inputH - (this.messages.length * lineH);

    // Draw message history — fade out older messages when chat is closed.
    this.messages.forEach((msg, i) => {
      const y       = baseY + i * lineH;
      const age     = (Date.now() - msg.timestamp) / 1000; // seconds
      const alpha   = this.isOpen ? 1 : Math.max(0, 1 - (age - 5) / 5); // visible 5s, fade over 5s

      if (alpha <= 0) return;

      const myId = (typeof socketManager !== 'undefined') ? socketManager.socket?.id : null;
      const isMe = (typeof playerManager !== 'undefined') && playerManager.mainPlayer?.name === msg.name;
      const displayName = isMe ? 'You' : msg.name;

      // Derive spinner-matching color from hue (sepia+saturate+hue-rotate produces ~hsl(H+36, 80%, 50%))
      const nameHue = msg.hue != null ? (msg.hue + 36) % 360 : null;
      const nameColor = nameHue != null ? `hsla(${nameHue},80%,65%,${alpha})` : `rgba(255,255,255,${alpha})`;

      ctx.font = `${msgFontSize}px monospace`;

      // Shadow for readability
      ctx.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
      ctx.fillText(`${displayName}: ${msg.text}`, x + 1, y + 1);

      // Colored name
      ctx.fillStyle = nameColor;
      const nameWidth = ctx.measureText(`${displayName}: `).width;
      ctx.fillText(`${displayName}: `, x, y);

      // White message text
      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.fillText(msg.text, x + nameWidth, y);
    });

    // Draw input box when open.
    if (this.isOpen) {
      const inputY = VIEW_H - bottomPad - inputH;
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(inputX - 4, inputY, 340, inputH);

      ctx.strokeStyle = '#4a6fa5';
      ctx.lineWidth   = 1;
      ctx.strokeRect(inputX - 4, inputY, 340, inputH);

      // Text (scrolled so the caret stays visible) + blinking caret.
      ctx.font      = `${msgFontSize}px monospace`;
      ctx.fillStyle = 'white';
      const caretIdx = this._el.selectionStart ?? this.input.length;
      const boxW = 340 - 10;
      const caretX = ctx.measureText(this.input.slice(0, caretIdx)).width;
      const scroll = Math.max(0, caretX - boxW);
      ctx.save();
      ctx.beginPath();
      ctx.rect(inputX - 2, inputY, boxW + 6, inputH);
      ctx.clip();
      ctx.fillText(this.input, inputX + 2 - scroll, inputY + 16);
      if (Math.floor(Date.now() / 500) % 2 === 0) {
        ctx.fillRect(inputX + 2 - scroll + caretX, inputY + 5, 1.5, 14);
      }
      ctx.restore();
    }

    ctx.restore();
  }
}

const chatManager = ChatManager.getInstance();
