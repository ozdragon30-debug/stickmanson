// The HTTP side: the game files under docs/, a JSON health check for
// orchestrators and a small status page for whoever runs the server.

const path = require('path');
const express = require('express');
const compression = require('compression');

const CLIENT_DIR = path.join(__dirname, '..', 'docs');

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, ch => HTML_ENTITIES[ch]);

// Code and data revalidate on every load so a deploy never mixes old and new
// scripts; heavy assets (sprite sheets, sounds, maps) may be cached an hour.
function cachePolicy(res, file) {
  const isCode = /\.(html|webmanifest|js|css)$/.test(file)
    || (file.endsWith('.json') && !file.includes('sprites'));
  res.setHeader('Cache-Control', isCode ? 'no-cache' : 'public, max-age=3600');
}

function hardenHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
}

function clockText(room) {
  if (room.phase !== 'playing') return 'round over';
  const secondsLeft = Math.max(0, Math.round((room.roundEndsAt - Date.now()) / 1000));
  return `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')} left`;
}

// Only the public room is listed by name. Private room codes are the invite
// secret, so those rooms are just counted.
function statusPage(registry) {
  const lobby = registry.lobby;
  const others = registry.privateRooms();
  const othersPlayers = others.reduce((sum, room) => sum + room.size, 0);
  const rows = Object.values(lobby.players)
    .sort((a, b) => b.kills - a.kills)
    .map(p => `<tr><td>${escapeHtml(p.name)}${p.afk ? ' 💤' : ''}</td><td>${p.kills}</td><td>${p.deaths}</td></tr>`)
    .join('') || '<tr><td colspan="3">No players right now</td></tr>';
  const mapName = escapeHtml(lobby.mapFile.replace(/\.dat$/, ''));

  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="10"><title>Stick Clash server status</title>
<style>body{font:15px system-ui,sans-serif;background:#0e1621;color:#c8d8e8;max-width:640px;margin:32px auto;padding:0 16px}
h1{color:#fff;font-size:22px}table{width:100%;border-collapse:collapse}td,th{padding:6px;border-bottom:1px solid #2d4060;text-align:left}
th{color:#7d93aa;font-size:12px;text-transform:uppercase}.k{color:#7d93aa}</style>
<h1>Stick Clash — server status</h1>
<p><span class="k">Public room:</span> ${mapName} · ${clockText(lobby)}
 · <span class="k">Private rooms:</span> ${others.length} (${othersPlayers} players)
 · <span class="k">Uptime:</span> ${Math.round(process.uptime() / 60)} min</p>
<table><tr><th>Player</th><th>Kills</th><th>Deaths</th></tr>${rows}</table>`;
}

// Installs the routes on an Express app.
function mountHttpSite(site, { registry, trustProxy }) {
  if (trustProxy) site.set('trust proxy', true);
  site.disable('x-powered-by');
  site.use(compression());
  site.use(hardenHeaders);

  site.get('/healthz', (_req, res) => {
    const lobby = registry.lobby;
    res.json({
      ok: true,
      players: registry.totalPlayers(),
      rooms: registry.rooms.size,
      map: lobby.mapFile,
      phase: lobby.phase,
      uptime: Math.round(process.uptime()),
    });
  });

  site.get('/status', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    res.send(statusPage(registry));
  });

  site.use(express.static(CLIENT_DIR, { setHeaders: cachePolicy }));
  site.get('/', (_req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));
}

module.exports = { mountHttpSite, escapeHtml };
