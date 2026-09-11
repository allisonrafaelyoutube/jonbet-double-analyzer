const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in cloud mode");
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const metaMem = {};

function setMeta(k, v) {
  metaMem[k] = String(v);
}

function getMeta(k) {
  return metaMem[k] || null;
}

async function insertSpin(spin) {
  const row = {
    round_id: spin.roundId || `${spin.rolledAt}|${spin.color}|${spin.number}`,
    color: spin.color,
    number: spin.number,
    rolled_at: spin.rolledAt,
    received_at: spin.receivedAt || new Date().toISOString(),
    source: spin.source || null,
    source_url: spin.sourceUrl || null,
  };

  const { error } = await supabase.from("spins").insert(row);
  if (error) {
    if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message || "")) {
      return false;
    }
    console.error("[supabase] insertSpin", error.message);
    return false;
  }
  return true;
}

async function insertRaw(_event) {
  // cloud: skip noisy raw storage
}

async function recentSpins(limit = 100) {
  const { data, error } = await supabase
    .from("spins")
    .select("*")
    .order("rolled_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[supabase] recentSpins", error.message);
    return [];
  }

  return (data || []).map((r) => ({
    id: r.id,
    roundId: r.round_id,
    color: r.color,
    number: r.number,
    rolledAt: r.rolled_at,
    receivedAt: r.received_at,
    source: r.source,
    sourceUrl: r.source_url,
  }));
}

async function recentRaw() {
  return [];
}

async function spinCount() {
  const { count, error } = await supabase
    .from("spins")
    .select("*", { count: "exact", head: true });
  if (error) {
    console.error("[supabase] spinCount", error.message);
    return 0;
  }
  return count || 0;
}

async function reset() {
  await supabase.from("spins").delete().neq("id", 0);
  for (const k of Object.keys(metaMem)) delete metaMem[k];
}

function flush() {}

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
  isSupabase: true,
};
