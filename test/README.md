# Tests

| File | What it checks |
|---|---|
| `golden.test.js` | Gameplay lock — physics, collision, hit shapes, weapon stats and every map must match `golden.json` |
| `server.test.js` | Multiplayer server via real socket.io clients (validation, rooms, reconnects, limits) |
| `input.test.js` | Analog → 8-direction quantisation, keybind migration |
| `i18n.test.js` | English/Turkish string tables are complete and consistent |
| `e2e/smoke.js` | Headless Chromium plays the game end to end (`npm run e2e`) |

New `*.test.js` files must be added to the `test` script in `package.json`
(explicit list so it works on every OS and never runs helper scripts such as
`golden-compute.js`, which rewrites `golden.json`).
