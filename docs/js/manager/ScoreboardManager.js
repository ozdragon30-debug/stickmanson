class ScoreboardManager {
  static getInstance() {
    if (!ScoreboardManager.instance) {
      ScoreboardManager.instance = new ScoreboardManager();
    }
    return ScoreboardManager.instance;
  }

  constructor() {
    this.scores = {};        // { [playerId]: { name, kills, deaths } }
    this.tabHeld = false;
    this.roundEndActive = false;
    this.roundEndsAt = null;
  }

  get isVisible() {
    return this.tabHeld || this.roundEndActive;
  }

  updateScores(scores) {
    this.scores = scores;
  }

  showRoundEnd(scores) {
    this.scores = scores;
    this.roundEndActive = true;
  }

  hideRoundEnd() {
    this.roundEndActive = false;
  }

  getRemainingTime() {
    if (!this.roundEndsAt) return 0;
    return Math.max(0, Math.ceil((this.roundEndsAt - Date.now()) / 1000));
  }

  draw(ctx, canvas) {
    ctx.save();
    resetScreenTransform(ctx);

    // Round timer — always visible, top-center (scaled up on phones).
    hudTransform(ctx, VIEW_W / 2, 0);
    const remaining = this.getRemainingTime();
    const minutes = Math.floor(remaining / 60);
    const seconds  = String(remaining % 60).padStart(2, '0');

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(VIEW_W / 2 - 42, 4, 84, 26);

    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${minutes}:${seconds}`, VIEW_W / 2, 23);

    // Rank under timer — use 'local_player' when offline (matches BotManager's key).
    const myId = (typeof socketManager !== 'undefined')
      ? (socketManager.socket?.id ?? 'local_player')
      : 'local_player';
    if (myId && this.scores && myId in this.scores) {
      const sorted = Object.entries(this.scores).sort((a, b) => b[1].kills - a[1].kills);
      const rank = sorted.findIndex(([id]) => id === myId) + 1;
      const total = sorted.length;
      const suffixes = ['th','st','nd','rd'];
      const suffix = (rank >= 11 && rank <= 13) ? 'th' : (suffixes[rank % 10] || 'th');
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(VIEW_W / 2 - 36, 31, 72, 17);
      ctx.fillStyle = '#aaccee';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      const ordinal = i18n.lang === 'tr' ? `${rank}.` : `${rank}${suffix}`; // Turkish: "2."
      ctx.fillText(`${ordinal} / ${total}`, VIEW_W / 2, 43);
    }

    if (this.isVisible) {
      // Grow on phones like the rest of the HUD, but keep the 620 px panel on screen.
      // Same panel geometry as _drawOverlay, so the scale can also be capped by height.
      const rows = Math.max(1, Object.keys(this.scores || {}).length);
      const panelH = Math.min(VIEW_H - 120, 128 + rows * 30 + 20);
      const py = Math.max(60, (VIEW_H - panelH) / 2 - 20);
      const cy = VIEW_H / 2;
      const u = Math.max(1, Math.min(display.uiScale || 1, VIEW_W / 660, cy / (cy - py), cy / (py + panelH - cy)));
      const s = display.scale;
      ctx.setTransform(s * u, 0, 0, s * u, s * (VIEW_W / 2) * (1 - u), s * (VIEW_H / 2) * (1 - u));
      this._drawOverlay(ctx, canvas);
    }

    // Bot status line under the timer/rank (kept clear of the chat box).
    if (typeof botManager !== 'undefined' && botManager.status !== 'none' && !this.isVisible) {
      const msg = botManager.status === 'no-server' ? t('hud.botsOffline') : t('hud.botsWaiting');
      ctx.font = '11px ui-monospace, monospace';
      const tw = ctx.measureText(msg).width;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(VIEW_W / 2 - tw / 2 - 6, 50, tw + 12, 16);
      ctx.fillStyle = botManager.status === 'no-server' ? '#ffb380' : '#9fd3ff';
      ctx.textAlign = 'center';
      ctx.fillText(msg, VIEW_W / 2, 62);
    }

    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  _drawOverlay(ctx, canvas) {
    const myId  = (typeof socketManager !== 'undefined')
      ? (socketManager.socket?.id ?? 'local_player')
      : 'local_player';
    const sorted = Object.entries(this.scores).sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths);

    const rowH = 30;
    const panelW = 620;
    const panelH = Math.min(VIEW_H - 120, 128 + Math.max(1, sorted.length) * rowH + 20);
    const px = (VIEW_W - panelW) / 2;
    const py = Math.max(60, (VIEW_H - panelH) / 2 - 20);

    // Panel
    ctx.fillStyle = 'rgba(8,13,20,0.86)';
    this._roundRect(ctx, px, py, panelW, panelH, 12);
    ctx.fill();
    ctx.strokeStyle = this.roundEndActive ? 'rgba(255,107,107,0.7)' : 'rgba(74,111,165,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Title + subtitle (map, time left)
    ctx.textAlign = 'center';
    ctx.fillStyle = this.roundEndActive ? '#ff6b6b' : '#ffffff';
    ctx.font = '900 24px system-ui, sans-serif';
    ctx.fillText(this.roundEndActive ? t('sb.over') : t('sb.title'), VIEW_W / 2, py + 38);

    const mapName = (typeof map !== 'undefined' && map.ready && map.name) ? mapLabelLocal(map.name) : '';
    const remaining = this.getRemainingTime();
    const timeTxt = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
    let sub = mapName;
    if (this.roundEndActive && sorted.length) {
      const [winId, win] = sorted[0];
      sub = (winId === myId ? t('sb.youWin') : t('sb.wins', { name: win.name })) + (mapName ? `  ·  ${mapName}` : '');
    } else if (this.roundEndsAt) {
      sub += (sub ? '  ·  ' : '') + t('sb.left', { t: timeTxt });
    }
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#8fa6bf';
    ctx.fillText(sub, VIEW_W / 2, py + 60);

    // Column headers
    const startY = py + 94;
    const colRank = px + 28;
    const colName = px + 56;
    const colKills = px + panelW - 210;
    const colDeaths = px + panelW - 130;
    const colKd = px + panelW - 52;

    ctx.fillStyle = '#6f86a0';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(t('sb.player'), colName, startY);
    ctx.textAlign = 'center';
    ctx.fillText('#', colRank, startY);
    ctx.fillText(t('sb.kills'), colKills, startY);
    ctx.fillText(t('sb.deaths'), colDeaths, startY);
    ctx.fillText(t('sb.kd'), colKd, startY);

    ctx.strokeStyle = '#2a3b52';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 16, startY + 9);
    ctx.lineTo(px + panelW - 16, startY + 9);
    ctx.stroke();

    const maxRows = Math.floor((py + panelH - startY - 16) / rowH);
    sorted.slice(0, maxRows).forEach(([id, data], i) => {
      const y    = startY + rowH * (i + 1);
      const isMe = id === myId;
      const displayName = isMe ? `${data.name} ${t('sb.you')}` : data.name;

      if (isMe) {
        ctx.fillStyle = 'rgba(74,158,255,0.16)';
        this._roundRect(ctx, px + 12, y - 20, panelW - 24, rowH - 4, 6);
        ctx.fill();
      }

      ctx.textAlign = 'center';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.fillStyle = i === 0 ? '#ffd166' : i === 1 ? '#d7dde5' : i === 2 ? '#e0a370' : '#7d93aa';
      ctx.fillText(i === 0 && this.roundEndActive ? '👑' : String(i + 1), colRank, y);

      // Spinner-matching name colour (sepia+saturate+hue-rotate shifts base by ~36°)
      const nameHue = ((data.indicatorHue ?? 0) + 36) % 360;
      ctx.fillStyle = `hsl(${nameHue},80%,${isMe ? '75%' : '68%'})`;
      ctx.font = isMe ? '700 15px system-ui, sans-serif' : '600 15px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(displayName, colName, y);

      ctx.fillStyle = isMe ? '#fff' : '#cfd8e3';
      ctx.font = '600 15px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(data.kills, colKills, y);
      ctx.fillText(data.deaths, colDeaths, y);
      const kd = data.deaths ? (data.kills / data.deaths).toFixed(2) : (data.kills ? data.kills.toFixed(2) : '–');
      ctx.fillStyle = '#8fa6bf';
      ctx.fillText(kd, colKd, y);
    });

    if (sorted.length > maxRows) {
      ctx.fillStyle = '#6f86a0';
      ctx.font = '12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t('sb.more', { n: sorted.length - maxRows }), VIEW_W / 2, py + panelH - 10);
    }
  }
}

const scoreboardManager = ScoreboardManager.getInstance();
