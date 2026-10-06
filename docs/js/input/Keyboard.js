// Keyboard: movement / fire / sprint keys, the scoreboard key, chat and the
// chat "!commands". Binds are stored as physical key codes
// (KeyboardEvent.code, e.g. "KeyW") so every layout works the same; older
// binds saved as KeyboardEvent.key values still match.

const ACTIONS = ['up', 'left', 'down', 'right', 'sprint', 'shoot'];
const MOVE_AND_FIRE = ['up', 'left', 'down', 'right', 'shoot'];
const noKeys = () => Object.fromEntries(ACTIONS.map(a => [a, false]));
let keys = noKeys();

const CODE_RE = /^(Key[A-Z]|Digit\d|Numpad|Arrow|Space$|Shift|Control|Alt|Meta|F\d|Enter|Tab|Backspace|Comma|Period|Slash|Semicolon|Quote|Bracket|Minus|Equal|Backquote|Backslash|IntlBackslash|CapsLock)/;

// Arrow keys always move too (as a second set).
const ARROW_ACTIONS = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };

function keyMatches(e, action) {
  const bind = settingsManager.getKey(action);
  if (!bind) return false;
  if (CODE_RE.test(bind)) return e.code === bind;
  return bind.length === 1 ? e.key.toLowerCase() === bind.toLowerCase() : e.key === bind;
}

function actionFor(e) {
  return ACTIONS.find(a => keyMatches(e, a)) || ARROW_ACTIONS[e.code] || null;
}

// Short label for a stored bind ("W", "Space", "↑", "Ctrl Left", "Num 4"…).
function keyLabel(bind) {
  if (!bind) return '—';
  if (bind === ' ' || bind === 'Space') return 'Space';
  const arrow = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[bind];
  if (arrow) return arrow;
  let m = /^Key([A-Z])$/.exec(bind) || /^Digit(\d)$/.exec(bind);
  if (m) return m[1];
  m = /^(Shift|Control|Alt|Meta)(Left|Right)$/.exec(bind);
  if (m) return `${m[1] === 'Control' ? 'Ctrl' : m[1]} ${m[2]}`;
  if (bind.length === 1) return bind.toUpperCase();
  return bind.replace(/^Numpad/, 'Num ');
}

// "!map name" → a map file of the offline list.
function findMapFile(name) {
  const base = name.toLowerCase().replace(/\.dat$/, '').replace(/\s+/g, '');
  const list = BotManager.OFFLINE_MAPS;
  return list.find(f => f === `${base}.dat`) || list.find(f => f.endsWith(`/${base}.dat`)) || null;
}

const offlineBots = () => botManager.active && !socketManager.isConnected;

// A line typed in chat: local "!" commands, otherwise a chat message.
function submitChat(text) {
  if (!text) return;
  const sys = (who, line) => chatManager.addMessage(who, line, null);
  const mute = /^!(un)?mute\s+(\S.*)$/.exec(text);
  if (text === '!help') {
    for (const line of t('chat.help').split('\n')) sys('?', line);
  } else if (mute) {
    const on = !mute[1];
    chatManager.setMuted(mute[2], on);
    sys('?', t(on ? 'chat.muted' : 'chat.unmuted', { name: mute[2] }));
  } else if (text === '!debug') {
    debugTiles = !debugTiles;
  } else if (text === '!fps') {
    settingsManager.set('showFps', !settingsManager.get('showFps'));
  } else if (text === '!next' && offlineBots()) {
    // Offline: end the round now, or start the next one.
    if (botManager._offlineRounds && botManager._roundPhase === 'playing') scoreboardManager.roundEndsAt = Date.now();
    else botManager.startOfflineRound(BotManager.randomMap(botManager._currentMap));
  } else if (text.startsWith('!map ') && offlineBots()) {
    const wanted = text.substring(5).trim();
    const file = findMapFile(wanted);
    if (!file) return sys('Server', `Unknown map: ${wanted}`);
    botManager.preferredMap = file;
    botManager.startOfflineRound(file);
  } else if (socketManager.isConnected) {
    socketManager.emit('chatMessage', { text });
  } else {
    // No server to echo it back: show it here.
    chatManager.addMessage(settingsManager.name, text.slice(0, 80), settingsManager.spinnerHue);
  }
}

// Shift shows the scoreboard unless it is bound to moving or firing.
function shiftIsGameBind(e) {
  return MOVE_AND_FIRE.some(a => keyMatches(e, a));
}

function keyDownHandler(e) {
  if (chatManager.isOpen) return;                          // the chat field owns the keys
  if (typeof menu !== 'undefined' && menu.isOpen) return;
  const tag = e.target?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (tag === 'BUTTON') {
    if (isUiBlocking()) return;                            // a menu button keeps its keys
    e.target.blur();
  }
  if (settingsManager.isOpen()) return;

  if (e.key === 'Enter') {
    e.preventDefault();
    chatManager.open();
    return;
  }
  const action = actionFor(e);
  if (action) {
    keys[action] = true;
    if (typeof inputMode !== 'undefined') inputMode.set('keyboard');
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    scoreboardManager.tabHeld = true;
  } else if (e.key === ' ') {
    e.preventDefault();
  } else if (e.key === 'Shift' && !shiftIsGameBind(e)) {
    scoreboardManager.tabHeld = true;
  }
}

function keyUpHandler(e) {
  for (const a of ACTIONS) if (keyMatches(e, a)) keys[a] = false;   // a key may serve several actions
  if (ARROW_ACTIONS[e.code]) keys[ARROW_ACTIONS[e.code]] = false;
  if (e.key === 'Tab' || e.key === 'Shift') scoreboardManager.tabHeld = false;
}

// Losing focus releases everything (no stuck keys or buttons).
function onBlurHandler() {
  keys = noKeys();
  if (typeof mouseLMBDown !== 'undefined') mouseLMBDown = false;
  if (typeof scoreboardManager !== 'undefined') scoreboardManager.tabHeld = false;
}

// Keyboard, gamepad and touch merged: every device drives the same movement.
function currentKeys() {
  const held = { ...keys };
  const others = [typeof gamepadInput !== 'undefined' && gamepadInput.keys, typeof touchInput !== 'undefined' && touchInput.keys];
  for (const src of others) {
    if (src) for (const a in src) if (src[a]) held[a] = true;
  }
  return held;
}

// Eight directions, checked in this order (diagonals first). Each entry:
// [needs, x sign, y sign, diagonal?, leg angle].
const MOVES = [
  [['up', 'right'], 1, -1, true, 45],
  [['up', 'left'], -1, -1, true, 135],
  [['down', 'right'], 1, 1, true, -45],
  [['down', 'left'], -1, 1, true, -315],
  [['up'], 0, -1, false, 0],
  [['left'], -1, 0, false, 90],
  [['down'], 0, 1, false, 0],
  [['right'], 1, 0, false, 90],
];

function keyEvents(dt) {
  const me = playerManager.mainPlayer;
  if (!me || me.isRespawning || isUiBlocking()) return;
  const held = currentKeys();
  if (held.shoot && me.canShoot) me.shoot();
  // px/s × dt: the same distance per second at any frame rate.
  const step = Constants.SPEED * (me.currentWeapon.walkSpeed ?? 1) * dt;
  const move = MOVES.find(([needs]) => needs.every(k => held[k]));
  if (!move) return;
  const [, sx, sy, diagonal, legs] = move;
  const d = diagonal ? step / 1.414 : step;      // diagonals keep the same speed
  me.move(sx ? sx * d : null, sy ? sy * d : null, legs);
}
