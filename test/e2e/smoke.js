// Browser smoke test: boots the real server, opens the game in Chromium and
// checks that it loads, plays, moves, shows the HUD and logs no errors —
// catching script load-order / runtime errors unit tests can't see.
// Run: npm run e2e   (CI installs Chromium with `npx playwright install chromium`)
process.env.PORT = '0';
process.env.QUIET = '1';
const assert = require('node:assert');
const { chromium, devices } = require('playwright');
const app = require('../../app.js');

(async () => {
  await new Promise(r => (app.server.listening ? r() : app.server.once('listening', r)));
  const url = `http://127.0.0.1:${app.server.address().port}/`;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(`${tag} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
  };
  try {
    // Desktop: menu → play → move → settings.
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 800 } })).newPage();
    watch(page, 'desktop');
    await page.goto(url);
    await page.waitForFunction(() => !document.getElementById('menu-play').disabled, null, { timeout: 30000 });
    await page.click('#menu-play');
    await page.waitForFunction(() => socketManager.isConnected, null, { timeout: 10000 });
    // Walk in all four directions; at least one must move (a wall can block some).
    let moved = false;
    for (const k of ['KeyD', 'KeyA', 'KeyS', 'KeyW']) {
      const before = await page.evaluate(() => [playerManager.mainPlayer.body.x, playerManager.mainPlayer.body.y]);
      await page.keyboard.down(k); await page.waitForTimeout(250); await page.keyboard.up(k);
      const after = await page.evaluate(() => [playerManager.mainPlayer.body.x, playerManager.mainPlayer.body.y]);
      if (after[0] !== before[0] || after[1] !== before[1]) moved = true;
      assert.ok(Number.isFinite(after[0]) && Number.isFinite(after[1]), 'position stays finite');
    }
    assert.ok(moved, 'player can move');
    await page.mouse.move(800, 300);
    await page.mouse.down(); await page.waitForTimeout(200); await page.mouse.up();
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sar-overlay.open');
    await page.keyboard.press('Escape');
    const st = await page.evaluate(() => ({ bots: Object.keys(botManager.bots).length, map: map.ready, fps: hudManager.fps }));
    assert.ok(st.map, 'map loaded');
    assert.ok(st.bots > 0, 'bots keep a lone player company');

    // Second player joins the same room → bots leave, players see each other.
    const p2 = await (await browser.newContext({ viewport: { width: 900, height: 700 } })).newPage();
    watch(p2, 'second');
    await p2.goto(url + '?play');
    await p2.waitForFunction(() => loopStarted && socketManager.isConnected, null, { timeout: 30000 });
    await page.waitForFunction(() => Object.keys(botManager.bots).length === 0 && Object.keys(playerManager.getPlayers()).length === 1, null, { timeout: 10000 });

    // Phone in Turkish: touch controls + localisation.
    const phone = await (await browser.newContext({ ...devices['Pixel 7'], locale: 'tr-TR' })).newPage();
    watch(phone, 'phone');
    await phone.goto(url + '?room=e2e-phone');
    await phone.waitForFunction(() => !document.getElementById('menu-play').disabled, null, { timeout: 30000 });
    assert.strictEqual(await phone.textContent('#menu-play'), 'Oyna');
    await phone.tap('#menu-play');
    await phone.waitForFunction(() => touchInput.enabled, null, { timeout: 5000 });

    // ?server= must never become a script source or inject markup (XSS).
    const sec = await (await browser.newContext()).newPage();
    let dialogs = 0;
    const foreignScripts = [];
    sec.on('dialog', d => { dialogs++; d.dismiss(); });
    sec.on('request', r => { if (r.resourceType() === 'script' && !r.url().startsWith(url)) foreignScripts.push(r.url()); });
    for (const payload of ['https%3A%2F%2Fa%22onerror%3D%22alert(1)%2F%2F', 'https://evil.example', 'javascript:alert(1)']) {
      await sec.goto(url + '?server=' + payload);
      await sec.waitForTimeout(300);
    }
    assert.strictEqual(dialogs, 0, 'no script injection through ?server');
    assert.deepStrictEqual(foreignScripts, [], 'no scripts loaded from ?server hosts');

    assert.deepStrictEqual(errors, []);
    console.log('e2e smoke: OK');
  } finally {
    await browser.close();
    await app.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
