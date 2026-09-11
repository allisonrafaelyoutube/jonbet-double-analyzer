/**
 * Storage facade: Supabase in cloud, JSON file locally.
 */
const useCloud = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const impl = useCloud ? require("./db-supabase") : require("./db-local");

async function insertSpin(spin) {
  return Promise.resolve(impl.insertSpin(spin));
}

async function insertRaw(event) {
  return Promise.resolve(impl.insertRaw(event));
}

async function recentSpins(limit) {
  return Promise.resolve(impl.recentSpins(limit));
}

async function recentRaw(limit) {
  return Promise.resolve(impl.recentRaw(limit));
}

async function spinCount() {
  return Promise.resolve(impl.spinCount());
}

async function reset() {
  return Promise.resolve(impl.reset());
}

function setMeta(key, value) {
  return impl.setMeta(key, value);
}

function getMeta(key) {
  return impl.getMeta(key);
}

function flush() {
  if (typeof impl.flush === "function") impl.flush();
}

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
  isSupabase: !!useCloud,
};
