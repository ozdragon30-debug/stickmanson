// Every tunable the server reads from the environment, resolved once at start-up.
// README.md ("Server options") and DEPLOY.md describe them for hosts.

const env = process.env;

const isOn  = value => /^(1|true|yes)$/i.test(value || '');
const isOff = value => /^(0|false|no)$/i.test(value || '');
// Integer from the environment; 0, blank or garbage falls back to the default.
const intSetting = (value, fallback) => parseInt(value, 10) || fallback;

module.exports = Object.freeze({
  // PORT=0 lets the OS choose a free port (the tests rely on that).
  port: env.PORT === undefined || env.PORT === '' ? 1138 : parseInt(env.PORT, 10),
  host: env.HOST || undefined,
  quiet: Boolean(env.QUIET),

  // X-Forwarded-For is only believed when a reverse proxy is declared.
  trustProxy: isOn(env.TRUST_PROXY),
  // Direct LAN / localhost players may use admin commands unless LAN_ADMIN=0
  // (the Docker image sets that: its NAT makes every player look local).
  lanAdmin: !isOff(env.LAN_ADMIN),
  adminPassword: env.ADMIN_PASSWORD || '',
  corsOrigins: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(',').map(o => o.trim()) : true,
  bansFile: env.BANS_FILE || '',

  roundMs: intSetting(env.ROUND_SECONDS, 300) * 1000,
  scoreboardMs: 10 * 1000,
  roomCapacity: intSetting(env.MAX_PLAYERS, 16),
  // Behind a proxy without TRUST_PROXY everyone shares one address, which
  // would turn this into a server-wide limit.
  connectionsPerAddress: intSetting(env.MAX_CONNECTIONS_PER_IP, 32),

  // An honest client sends about 60 moves, 20 leg frames and a few other
  // events per second. Packets over this budget are discarded; a socket that
  // sends more than four times the budget for three seconds running is cut off.
  packetBudgetPerSecond: 200,
  // A dropped player who comes back with the same session token inside this
  // window keeps the round score, and nobody sees "left"/"joined" lines.
  rejoinWindowMs: 12000,
});
