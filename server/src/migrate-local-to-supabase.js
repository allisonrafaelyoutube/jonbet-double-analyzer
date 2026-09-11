/**
 * One-shot: envia spins do store.json local para o Supabase.
 * Uso: node src/migrate-local-to-supabase.js
 */
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no server/.env");
    process.exit(1);
  }

  const storePath = path.join(__dirname, "..", "data", "store.json");
  if (!fs.existsSync(storePath)) {
    console.log("Nenhum store.json local para migrar.");
    return;
  }

  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const spins = Array.isArray(store.spins) ? store.spins : [];
  console.log(`Encontrados ${spins.length} giros locais`);

  if (!spins.length) return;

  // supabase-js needs ws on some Node versions
  try {
    const WS = require("ws");
    if (!global.WebSocket) global.WebSocket = WS;
  } catch {
    /* ignore */
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = spins
    .map((s) => ({
      round_id: s.roundId || `${s.rolledAt}|${s.color}|${s.number}`,
      color: s.color,
      number: s.number,
      rolled_at: s.rolledAt,
      received_at: s.receivedAt || s.rolledAt || new Date().toISOString(),
      source: s.source || "local-migrate",
      source_url: s.sourceUrl || null,
    }))
    .filter((r) => r.color && r.number != null && r.rolled_at);

  // oldest first so upserts are stable
  rows.reverse();

  const chunk = 100;
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase.from("spins").upsert(slice, {
      onConflict: "round_id",
      ignoreDuplicates: true,
    });
    if (error) {
      console.error("chunk error", error.message);
      // fallback row by row
      for (const row of slice) {
        const { error: e2 } = await supabase.from("spins").insert(row);
        if (e2) skipped += 1;
        else inserted += 1;
      }
    } else {
      inserted += slice.length;
    }
    console.log(`… ${Math.min(i + chunk, rows.length)}/${rows.length}`);
  }

  const { count } = await supabase.from("spins").select("*", { count: "exact", head: true });
  console.log(`Migração ok. Inseridos/enviados≈${inserted}, falhas≈${skipped}, total no Supabase=${count}`);

  // backup local then slim file (keep empty shell)
  const bak = storePath.replace(/\.json$/, `.backup-${Date.now()}.json`);
  fs.copyFileSync(storePath, bak);
  fs.writeFileSync(
    storePath,
    JSON.stringify({ spins: [], raw_events: [], meta: { migrated_to_supabase: new Date().toISOString() }, nextSpinId: 1, nextRawId: 1 }),
    "utf8"
  );
  console.log(`Backup local: ${bak}`);
  console.log("store.json limpo (histórico agora no Supabase)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
