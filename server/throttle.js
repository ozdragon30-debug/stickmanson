// Rate limits: per-action windows, the per-victim hit budget, the per-socket
// packet budget and the cap on simultaneous connections from one address.

// Allows `limit` actions per window. A window opens with the first action and
// restarts with the first action after it has fully elapsed.
class ActionWindow {
  constructor(limit, windowMs) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.openedAt = null;
    this.used = 0;
  }

  tryUse(now = Date.now()) {
    if (this.openedAt === null || now - this.openedAt > this.windowMs) {
      this.openedAt = now;
      this.used = 0;
    }
    this.used += 1;
    return this.used <= this.limit;
  }
}

// Hits one attacker may land on one victim. The budget refills by one hit per
// weapon cooldown and holds at most two, so genuine hits that network jitter
// bunched together still count while a faster-than-the-gun stream does not.
const HIT_BUDGET_CAP = 2;

class HitBudget {
  constructor() {
    this.perVictim = new Map();
  }

  spend(victimId, cooldownMs, now = Date.now()) {
    let entry = this.perVictim.get(victimId);
    if (!entry) {
      entry = { left: HIT_BUDGET_CAP, at: now };
      this.perVictim.set(victimId, entry);
    }
    entry.left = Math.min(HIT_BUDGET_CAP, entry.left + (now - entry.at) / cooldownMs);
    entry.at = now;
    if (entry.left < 1) return false;
    entry.left -= 1;
    return true;
  }
}

// Counts incoming packets per one-second slice. Packets over the budget are
// discarded without a word; three slices in a row over four times the budget
// disconnect the socket.
function guardPacketFlood(socket, budget) {
  const STRIKES_TO_DROP = 3;
  let sliceStart = Date.now();
  let inSlice = 0;
  let strikes = 0;
  socket.use((_packet, proceed) => {
    const now = Date.now();
    if (now - sliceStart >= 1000) {
      strikes = inSlice > budget * 4 ? strikes + 1 : 0;
      if (strikes >= STRIKES_TO_DROP) {
        socket.disconnect(true);
        return;
      }
      sliceStart = now;
      inSlice = 0;
    }
    inSlice += 1;
    if (inSlice <= budget) proceed();
  });
}

// Handshake middleware refusing a new socket once an address already holds
// `limit` open connections.
function capConnectionsPerAddress(io, addressOf, limit) {
  const open = new Map();
  io.use((socket, proceed) => {
    const addr = addressOf(socket);
    const held = open.get(addr) || 0;
    if (held >= limit) return proceed(new Error('Too many connections from your address.'));
    open.set(addr, held + 1);
    socket.once('disconnect', () => {
      const remaining = (open.get(addr) || 1) - 1;
      if (remaining > 0) open.set(addr, remaining);
      else open.delete(addr);
    });
    proceed();
  });
}

module.exports = { ActionWindow, HitBudget, guardPacketFlood, capConnectionsPerAddress };
