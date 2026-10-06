let keys = {
  up:     false,
  left:   false,
  down:   false,
  right:  false,
  sprint: false,
  shoot:  false,
};

// Keybinds are stored as physical key codes (KeyboardEvent.code, e.g. "KeyW"),
// so they work on every layout (Turkish Q/F, AZERTY, Dvorak…) and with Caps Lock.
// Legacy binds saved as KeyboardEvent.key values are still honoured.
const CODE_RE = /^(Key[A-Z]|Digit\d|Numpad|Arrow|Space$|Shift|Control|Alt|Meta|F\d|Enter|Tab|Backspace|Comma|Period|Slash|Semicolon|Quote|Bracket|Minus|Equal|Backquote|Backslash|IntlBackslash|CapsLock)/;

function keyMatches(event, action) {
  const bound = settingsManager.getKey(action);
  if (!bound) return false;
  if (CODE_RE.test(bound)) return event.code === bound;
  if (bound.length === 1) return event.key.toLowerCase() === bound.toLowerCase();
  return event.key === bound;
}

// Arrow keys always work as a secondary movement set (unless rebound elsewhere).
const ARROW_ACTIONS = { ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };

function actionFor(event) {
  for (const action of ['up', 'left', 'down', 'right', 'sprint', 'shoot']) {
    if (keyMatches(event, action)) return action;
  }
  return ARROW_ACTIONS[event.code] || null;
}

// Human-readable label for a stored bind (code or legacy key).
function keyLabel(bound) {
  if (!bound) return '—';
  if (bound === ' ' || bound === 'Space') return 'Space';
  if (/^Key[A-Z]$/.test(bound)) return bound.slice(3);
  if (/^Digit\d$/.test(bound)) return bound.slice(5);
  const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[bound]) return arrows[bound];
  if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(bound)) return bound.replace(/(Left|Right)$/, ' $1').replace('Control', 'Ctrl');
  if (bound.length === 1) return bound.toUpperCase();
  return bound.replace(/^Numpad/, 'Num ');
}

// Resolve "!map name" to a map file using the full offline map list.
function findMapFile(name) {
  const n = name.toLowerCase().replace(/\.dat$/, '').replace(/\s+/g, '');
  const maps = BotManager.OFFLINE_MAPS;
  return maps.find(f => f === n + '.dat') || maps.find(f => f.endsWith('/' + n + '.dat')) || null;
}

// Handles a submitted chat line: local "!" commands first, then sends to server.
function submitChat(text) {
  if (!text) return;
  if (text === '!help') {
    for (const line of t('chat.help').split('\n')) chatManager.addMessage('?', line, null);
  } else if (/^!(un)?mute\s+\S/.test(text)) {
    const on = text.startsWith('!mute');
    const who = text.replace(/^!(un)?mute\s+/, '');
    chatManager.setMuted(who, on);
    chatManager.addMessage('?', t(on ? 'chat.muted' : 'chat.unmuted', { name: who }), null);
  } else if (text === '!debug') {
    debugTiles = !debugTiles;
  } else if (text === '!fps') {
    settingsManager.set('showFps', !settingsManager.get('showFps'));
  } else if (text === '!next' && botManager.active && !socketManager.isConnected) {
    // Offline: end the current round now (same as the server's !next).
    if (botManager._offlineRounds && botManager._roundPhase === 'playing') scoreboardManager.roundEndsAt = Date.now();
    else loadMap(BotManager.randomMap());
  } else if (text.startsWith('!map ') && (botManager.active || !socketManager.isConnected)) {
    const mapFile = findMapFile(text.substring(5).trim());
    if (mapFile) loadMap(mapFile);
    else chatManager.addMessage('Server', `Unknown map: ${text.substring(5).trim()}`, null);
  } else if (socketManager.isConnected) {
    socketManager.emit('chatMessage', { text });
  } else {
    // Offline: there is no server to echo the message back, so show it locally
    // (it used to vanish silently).
    chatManager.addMessage(settingsManager.name, text.slice(0, 80), settingsManager.spinnerHue);
  }
}

function keyDownHandler(event) {
  // While chat is open the focused <input> owns the keyboard.
  if (chatManager.isOpen) return;
  // Menus and focused form controls (Play button, name field…) keep their keys.
  if (typeof menu !== 'undefined' && menu.isOpen) return;
  const tag = event.target && event.target.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;

  // Settings panel handles Escape via capture phase; suppress game input while open.
  if (settingsManager.isOpen()) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    chatManager.open();
    return;
  }

  const action = actionFor(event);
  if (action) {
    keys[action] = true;
    if (typeof inputMode !== 'undefined') inputMode.set('keyboard');
    if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
  }

  if (event.key === 'Tab') {
    event.preventDefault();
    scoreboardManager.tabHeld = true;
  } else if (event.key === ' ') {
    event.preventDefault();
  } else if (event.key === 'Shift') {
    scoreboardManager.tabHeld = true;
  }
}

function keyUpHandler(event) {
  // Release every action bound to this key (a key may be in several sets).
  for (const a of ['up', 'left', 'down', 'right', 'sprint', 'shoot']) {
    if (keyMatches(event, a)) keys[a] = false;
  }
  if (ARROW_ACTIONS[event.code]) keys[ARROW_ACTIONS[event.code]] = false;

  if (event.key === 'Tab' || event.key === 'Shift') scoreboardManager.tabHeld = false;
}

function onBlurHandler() {
  keys = { up: false, left: false, down: false, right: false, sprint: false, shoot: false };
  if (typeof mouseLMBDown !== 'undefined') mouseLMBDown = false;
  if (typeof scoreboardManager !== 'undefined') scoreboardManager.tabHeld = false;
}

// Union of keyboard, gamepad and touch inputs. Every device drives the exact
// same 8-direction movement below, so movement physics are identical.
function currentKeys() {
  const k = { ...keys };
  for (const src of [typeof gamepadInput !== 'undefined' ? gamepadInput.keys : null,
                     typeof touchInput   !== 'undefined' ? touchInput.keys   : null]) {
    if (!src) continue;
    for (const a in src) if (src[a]) k[a] = true;
  }
  return k;
}

function keyEvents(dt) {
  if (!playerManager.mainPlayer || playerManager.mainPlayer.isRespawning) return;
  if (isUiBlocking()) return;
  const keys = currentKeys();

  if (keys.shoot && playerManager.mainPlayer.canShoot) {
    playerManager.mainPlayer.shoot();
  }

  // Speed in px/s multiplied by dt gives frame-rate-independent px this frame.
  const weaponMult = playerManager.mainPlayer.currentWeapon.walkSpeed ?? 1;
  const spd = Constants.SPEED * weaponMult * dt;

  if (keys.up && keys.right) {
    playerManager.mainPlayer.move(spd / 1.414, -spd / 1.414, 45);
  } else if (keys.up && keys.left) {
    playerManager.mainPlayer.move(-spd / 1.414, -spd / 1.414, 135);
  } else if (keys.down && keys.right) {
    playerManager.mainPlayer.move(spd / 1.414, spd / 1.414, -45);
  } else if (keys.down && keys.left) {
    playerManager.mainPlayer.move(-spd / 1.414, spd / 1.414, -315);
  } else if (keys.up) {
    playerManager.mainPlayer.move(null, -spd, 0);
  } else if (keys.left) {
    playerManager.mainPlayer.move(-spd, null, 90);
  } else if (keys.down) {
    playerManager.mainPlayer.move(null, spd, 0);
  } else if (keys.right) {
    playerManager.mainPlayer.move(spd, null, 90);
  }
}
