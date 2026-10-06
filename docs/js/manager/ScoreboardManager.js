// Round timer, rank badge and the scoreboard panel (Tab / Shift, and at
// round end). Scores: { [playerId]: { name, kills, deaths, indicatorHue } }.

// The one ranking rule used everywhere: most kills, then fewest deaths.
function compareScores(a, b) {
  return b[1].kills - a[1].kills || a[1].deaths - b[1].deaths;
}

const SB = {
  rowH: 30,
  panelW: 620,
  medal: ['#ffd166', '#d7dde5', '#e0a370'],
  font: (w, px, fam = 'system-ui, sans-serif') => `${w} ${px}px ${fam}`,
};

class ScoreboardManager {
  static getInstance() {
    return ScoreboardManager.instance || (ScoreboardManager.instance = new ScoreboardManager());
  }

  constructor() {
    this.scores = {};
    this.tabHeld = false;
    this.roundEndActive = false;
    this.roundEndsAt = null;
  }

  get isVisible() { return this.tabHeld || this.roundEndActive; }

  updateScores(scores) { this.scores = scores; }
  showRoundEnd(scores) { this.scores = scores; this.roundEndActive = true; }
  hideRoundEnd() { this.roundEndActive = false; }

  // Whole seconds left in the round.
  getRemainingTime() {
    return this.roundEndsAt ? Math.max(0, Math.ceil((this.roundEndsAt - Date.now()) / 1000)) : 0;
  }

  static clock(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }

  // Offline the local player is scored as 'local_player' (see BotManager).
  static myId() {
    return (typeof socketManager !== 'undefined' && socketManager.socket?.id) || 'local_player';
  }

  ranked() { return Object.entries(this.scores || {}).sort(compareScores); }

  static ordinal(rank) {
    if (i18n.lang === 'tr') return `${rank}.`;
    const teen = rank >= 11 && rank <= 13;
    return rank + (teen ? 'th' : ['th', 'st', 'nd', 'rd'][rank % 10] || 'th');
  }

  draw(ctx, canvas) {
    ctx.save();
    resetScreenTransform(ctx);
    hudTransform(ctx, VIEW_W / 2, 0);
    const cx = VIEW_W / 2;

    // Timer, always shown at the top.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(cx - 42, 4, 84, 26);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ScoreboardManager.clock(this.getRemainingTime()), cx, 23);

    // My place under it.
    const me = ScoreboardManager.myId();
    if (this.scores && me in this.scores) {
      const list = this.ranked();
      const rank = list.findIndex(([id]) => id === me) + 1;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(cx - 36, 31, 72, 17);
      ctx.fillStyle = '#aaccee';
      ctx.font = '11px monospace';
      ctx.fillText(`${ScoreboardManager.ordinal(rank)} / ${list.length}`, cx, 43);
    }

    if (this.isVisible) {
      this._fitPanelTransform(ctx);
      this._drawOverlay(ctx, canvas);
    }

    // Bot match status (hidden while the panel is up).
    if (typeof botManager !== 'undefined' && botManager.status !== 'none' && !this.isVisible) {
      const offline = botManager.status === 'no-server';
      const msg = offline ? t('hud.botsOffline') : t('hud.botsWaiting');
      ctx.font = '11px ui-monospace, monospace';
      const w = ctx.measureText(msg).width;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(cx - w / 2 - 6, 50, w + 12, 16);
      ctx.fillStyle = offline ? '#ffb380' : '#9fd3ff';
      ctx.textAlign = 'center';
      ctx.fillText(msg, cx, 62);
    }
    ctx.restore();
  }

  // Panel height for n rows, and its top edge.
  static panelBox(rows) {
    const h = Math.min(VIEW_H - 120, 128 + Math.max(1, rows) * SB.rowH + 20);
    return { h, y: Math.max(60, (VIEW_H - h) / 2 - 20) };
  }

  // Scale the panel up on phones like the HUD, but never off screen.
  _fitPanelTransform(ctx) {
    const { h, y } = ScoreboardManager.panelBox(Object.keys(this.scores || {}).length);
    const mid = VIEW_H / 2;
    const u = Math.max(1, Math.min(display.uiScale || 1, VIEW_W / 660, mid / (mid - y), mid / (y + h - mid)));
    const s = display.scale;
    ctx.setTransform(s * u, 0, 0, s * u, s * (display.extraX + (VIEW_W / 2) * (1 - u)), s * (display.extraY + (VIEW_H / 2) * (1 - u)));
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  _drawOverlay(ctx) {
    const me = ScoreboardManager.myId();
    const list = this.ranked();
    const W = SB.panelW;
    const { h: H, y: top } = ScoreboardManager.panelBox(list.length);
    const left = (VIEW_W - W) / 2, cx = VIEW_W / 2;
    const over = this.roundEndActive;

    ctx.fillStyle = 'rgba(8,13,20,0.86)';
    this._roundRect(ctx, left, top, W, H, 12);
    ctx.fill();
    ctx.strokeStyle = over ? 'rgba(255,107,107,0.7)' : 'rgba(74,111,165,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = over ? '#ff6b6b' : '#ffffff';
    ctx.font = SB.font(900, 24);
    ctx.fillText(over ? t('sb.over') : t('sb.title'), cx, top + 38);

    // Subtitle: winner or time left, and the map.
    const mapName = typeof map !== 'undefined' && map.ready && map.name ? mapLabelLocal(map.name) : '';
    let sub = mapName;
    if (over && list.length) {
      const [winId, win] = list[0];
      sub = (winId === me ? t('sb.youWin') : t('sb.wins', { name: win.name })) + (mapName ? `  ·  ${mapName}` : '');
    } else if (this.roundEndsAt) {
      sub += (sub ? '  ·  ' : '') + t('sb.left', { t: ScoreboardManager.clock(this.getRemainingTime()) });
    }
    ctx.font = SB.font(600, 13);
    ctx.fillStyle = '#8fa6bf';
    ctx.fillText(sub, cx, top + 60);

    // Columns.
    const headY = top + 94;
    const col = { rank: left + 28, name: left + 56, kills: left + W - 210, deaths: left + W - 130, kd: left + W - 52 };
    ctx.fillStyle = '#6f86a0';
    ctx.font = SB.font(700, 11);
    ctx.textAlign = 'left';
    ctx.fillText(t('sb.player'), col.name, headY);
    ctx.textAlign = 'center';
    ctx.fillText('#', col.rank, headY);
    ctx.fillText(t('sb.kills'), col.kills, headY);
    ctx.fillText(t('sb.deaths'), col.deaths, headY);
    ctx.fillText(t('sb.kd'), col.kd, headY);
    ctx.strokeStyle = '#2a3b52';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left + 16, headY + 9);
    ctx.lineTo(left + W - 16, headY + 9);
    ctx.stroke();

    const fits = Math.floor((top + H - headY - 16) / SB.rowH);
    list.slice(0, fits).forEach(([id, row], i) => this._drawRow(ctx, row, i, id === me, headY + SB.rowH * (i + 1), left, W, col));

    if (list.length > fits) {
      ctx.fillStyle = '#6f86a0';
      ctx.font = SB.font('', 12).trim();
      ctx.textAlign = 'center';
      ctx.fillText(t('sb.more', { n: list.length - fits }), cx, top + H - 10);
    }
  }

  _drawRow(ctx, row, i, mine, y, left, W, col) {
    if (mine) {
      ctx.fillStyle = 'rgba(74,158,255,0.16)';
      this._roundRect(ctx, left + 12, y - 20, W - 24, SB.rowH - 4, 6);
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.font = SB.font(700, 13);
    ctx.fillStyle = SB.medal[i] || '#7d93aa';
    ctx.fillText(i === 0 && this.roundEndActive ? '👑' : String(i + 1), col.rank, y);

    // Name in the colour of the player's spinner (the tint shifts hue by ~36°).
    const hue = ((row.indicatorHue ?? 0) + 36) % 360;
    ctx.fillStyle = `hsl(${hue},80%,${mine ? '75%' : '68%'})`;
    ctx.font = SB.font(mine ? 700 : 600, 15);
    ctx.textAlign = 'left';
    ctx.fillText(this._fitName(ctx, row.name, mine ? ` ${t('sb.you')}` : '', col.kills - col.name - 40), col.name, y);

    ctx.fillStyle = mine ? '#fff' : '#cfd8e3';
    ctx.font = SB.font(600, 15, 'ui-monospace, monospace');
    ctx.textAlign = 'center';
    ctx.fillText(row.kills, col.kills, y);
    ctx.fillText(row.deaths, col.deaths, y);
    const kd = row.deaths ? (row.kills / row.deaths).toFixed(2) : row.kills ? row.kills.toFixed(2) : '–';
    ctx.fillStyle = '#8fa6bf';
    ctx.fillText(kd, col.kd, y);
  }

  // Shortens a long name with "…" so it never runs into the Kills column.
  _fitName(ctx, name, suffix, maxW) {
    if (ctx.measureText(name + suffix).width <= maxW) return name + suffix;
    let base = name;
    while (base.length > 1 && ctx.measureText(base + '…' + suffix).width > maxW) base = base.slice(0, -1);
    return base + '…' + suffix;
  }
}

const scoreboardManager = ScoreboardManager.getInstance();
