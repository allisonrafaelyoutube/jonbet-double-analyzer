const fs = require("fs");
const path = require("path");

const dataDir = path.join(__dirname, "..", "data");
const storePath = path.join(dataDir, "store.json");

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function defaultStore() {
  return { spins: [], raw_events: [], meta: {}, nextSpinId: 1, nextRawId: 1 };
}

function load() {
  try {
    if (!fs.existsSync(storePath)) return defaultStore();
    return { ...defaultStore(), ...JSON.parse(fs.readFileSync(storePath, "utf8")) };
  } catch {
    return defaultStore();
  }
}

let store = load();
let dirty = false;
let saveTimer = null;
const SAVE_DEBOUNCE_MS = 200;

function flush() {
  if (!dirty) return;
  dirty = false;
  try {
    fs.writeFileSync(storePath, JSON.stringify(store), "utf8");
  } catch (err) {
    dirty = true;
    console.error("[db] save failed", err && err.message ? err.message : err);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, SAVE_DEBOUNCE_MS);
}

function saveNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  dirty = true;
  flush();
}

function setMeta(key, value) {
  const v = String(value);
  if (store.meta[key] === v) return;
  store.meta[key] = v;
  scheduleSave();
}

function getMeta(key) {
  return store.meta[key] || null;
}

function insertSpin(spin) {
  const roundId = spin.roundId || null;
  if (roundId && store.spins.some((s) => s.roundId === roundId)) return false;

  const t = Date.parse(spin.rolledAt);
  const dup = store.spins.find((s) => {
    if (s.color !== spin.color || s.number !== spin.number) return false;
    const dt = Math.abs(Date.parse(s.rolledAt) - t);
    return dt < 2000;
  });
  if (dup) return false;

  store.spins.unshift({
    id: store.nextSpinId++,
    roundId,
    color: spin.color,
    number: spin.number,
    rolledAt: spin.rolledAt,
    receivedAt: spin.receivedAt,
    source: spin.source || null,
    sourceUrl: spin.sourceUrl || null,
  });

  if (store.spins.length > 5000) store.spins.length = 5000;
  scheduleSave();
  return true;
}

function insertRaw(event) {
  store.raw_events.unshift({
    id: store.nextRawId++,
    receivedAt: event.receivedAt,
    wsUrl: event.wsUrl || null,
    payload:
      typeof event.payload === "string" ? event.payload : JSON.stringify(event.payload),
  });
  if (store.raw_events.length > 200) store.raw_events.length = 200;
  scheduleSave();
}

function recentSpins(limit = 100) {
  return store.spins.slice(0, limit);
}

function recentRaw(limit = 50) {
  return store.raw_events.slice(0, limit);
}

function spinCount() {
  return store.spins.length;
}

function reset() {
  store = defaultStore();
  saveNow();
}

process.on("exit", flush);
process.on("SIGINT", () => {
  flush();
  process.exit(0);
});
process.on("SIGTERM", () => {
  flush();
  process.exit(0);
});

module.exports = {
  insertSpin,
  insertRaw,
  recentSpins,
  recentRaw,
  spinCount,
  setMeta,
  getMeta,
  reset,
  flush,
};
