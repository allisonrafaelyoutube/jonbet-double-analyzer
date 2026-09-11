const path = require("path");
const express = require("express");
const cors = require("cors");
const db = require("./db");
const { parsePayload, normalizeIncomingSpin } = require("./parser");
const { loadRules, saveRules, computeMetrics, maybeAlert } = require("./rules");
const { startPoller, ingestGames } = require("./poller");

const PORT = Number(process.env.PORT || 8787);
const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "4mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

function touchHeartbeat() {
  db.setMeta("last_extension_at", new Date().toISOString());
}

async function apiStatus() {
  // Fonte de verdade: último giro gravado (extensão ou poller)
  let newestReceivedAt = null;
  try {
    const recent = await db.recentSpins(1);
    if (recent[0]?.receivedAt) newestReceivedAt = recent[0].receivedAt;
    else if (recent[0]?.rolledAt) newestReceivedAt = recent[0].rolledAt;
  } catch {
    /* ignore */
  }

  const lastApiAt = db.getMeta("last_api_at");
  const lastExtAt = db.getMeta("last_extension_at");
  const failStreak = Number(db.getMeta("api_fail_streak") || 0);
  const cloudBlocked = db.getMeta("cloud_poll_blocked") === "1";

  const ages = [];
  for (const iso of [newestReceivedAt, lastApiAt, lastExtAt]) {
    if (!iso) continue;
    const ms = Date.now() - Date.parse(iso);
    if (Number.isFinite(ms) && ms >= 0) ages.push(ms);
  }
  const ageMs = ages.length ? Math.min(...ages) : Infinity;
  // Double ~30s/rodada — toleramos até 2 min sem dado novo
  const fresh = ageMs < 120000;
  const okFlag = db.getMeta("last_api_ok") === "1";

  return {
    lastApiAt: lastApiAt || newestReceivedAt,
    lastDataAt: newestReceivedAt,
    lastExtensionAt: lastExtAt,
    apiOk: fresh || (okFlag && failStreak < 5) || (cloudBlocked && fresh),
    apiFresh: fresh,
    apiAgeSec: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    apiFailStreak: failStreak,
    lastApiError: db.getMeta("last_api_error") || null,
    lastApiUrl: db.getMeta("last_api_url") || null,
    cloudPollBlocked: cloudBlocked,
    storage: db.isSupabase ? "supabase" : "local-json",
  };
}

app.get("/health", async (_req, res) => {
  const status = await apiStatus();
  res.json({
    ok: true,
    spins: await db.spinCount(),
    lastExtensionAt: status.lastExtensionAt || db.getMeta("last_extension_at"),
    now: new Date().toISOString(),
    ...status,
  });
});

app.post("/events", async (req, res) => {
  touchHeartbeat();
  const body = req.body || {};
  const receivedAt = body.receivedAt || new Date().toISOString();
  const source = body.source || "unknown";
  const wsUrl = body.url || body.wsUrl || null;
  const saveRaw = body.saveRaw === true;

  let inserted = 0;
  const alerts = [];
  const candidates = [];

  if (Array.isArray(body.games) && body.games.length) {
    inserted += await ingestGames(
      db,
      body.games,
      body.apiUrl || "extension-api",
      source || "extension-api"
    );
    db.setMeta("last_api_at", new Date().toISOString());
    db.setMeta("last_api_ok", "1");
    db.setMeta("api_fail_streak", "0");
    db.setMeta("last_api_error", "");
    // sync via extensão é o caminho válido na nuvem
    db.setMeta("last_extension_sync_at", new Date().toISOString());
  }

  if (body.spin) {
    const n = normalizeIncomingSpin(body.spin);
    if (n) candidates.push(n);
  }

  if (Array.isArray(body.spins)) {
    for (const s of body.spins) {
      const n = normalizeIncomingSpin(s);
      if (n) candidates.push(n);
    }
  }

  if (source === "websocket") {
    const spins = parsePayload(body.raw, {
      binaryBase64: body.binaryBase64 || (body.raw && body.raw.binaryBase64),
    });
    for (const s of spins) candidates.push(s);

    if (saveRaw && spins.length) {
      try {
        const decodedSpins = spins.map((s) => `${s.color}:${s.number}`).join(",");
        await db.insertRaw({
          receivedAt,
          wsUrl,
          payload: `[binary decoded] ${decodedSpins}`,
        });
      } catch {
        /* ignore */
      }
    }
  }

  for (const spin of candidates) {
    const n = normalizeIncomingSpin(spin) || spin;
    if (!n || !n.color || n.number == null) continue;
    const rolledAt = n.rolledAt || receivedAt;
    const roundId = n.roundId || `${rolledAt}|${n.color}|${n.number}`;
    const ok = await db.insertSpin({
      roundId,
      color: n.color,
      number: n.number,
      rolledAt,
      receivedAt,
      source,
      sourceUrl: wsUrl,
    });
    if (ok) inserted += 1;
  }

  if (inserted > 0) {
    const metrics = computeMetrics(await db.recentSpins(200));
    const fired = maybeAlert(metrics, loadRules());
    if (fired) alerts.push(fired);
  }

  res.json({ ok: true, inserted, alerts });
});

app.post("/api/reset", async (_req, res) => {
  await db.reset();
  res.json({ ok: true });
});

app.get("/api/spins", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ data: await db.recentSpins(limit) });
});

app.get("/api/stats", async (_req, res) => {
  const spins = await db.recentSpins(500);
  const metrics = computeMetrics(spins);
  const status = await apiStatus();
  res.json({
    metrics,
    rules: loadRules(),
    ...status,
  });
});

app.get("/api/rules", (_req, res) => {
  res.json(loadRules());
});

app.put("/api/rules", (req, res) => {
  const current = loadRules();
  const next = { ...current, ...req.body };
  if (req.body.whiteGap) next.whiteGap = { ...current.whiteGap, ...req.body.whiteGap };
  if (req.body.sameColorStreak) {
    next.sameColorStreak = { ...current.sameColorStreak, ...req.body.sameColorStreak };
  }
  saveRules(next);
  res.json(next);
});

app.get("/api/raw", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ data: await db.recentRaw(limit) });
});

startPoller(db, {
  onInsert: async (inserted) => {
    if (inserted > 0) {
      const metrics = computeMetrics(await db.recentSpins(200));
      maybeAlert(metrics, loadRules());
    }
  },
});

const host = process.env.HOST || "0.0.0.0";
app.listen(PORT, host, () => {
  console.log(`Jonbet Double Analyzer → http://${host}:${PORT}`);
  console.log(`Storage: ${db.isSupabase ? "supabase" : "local-json"}`);
});
