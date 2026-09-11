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

function apiStatus() {
  const lastApiAt = db.getMeta("last_api_at");
  const failStreak = Number(db.getMeta("api_fail_streak") || 0);
  const ageMs = lastApiAt ? Date.now() - Date.parse(lastApiAt) : Infinity;
  const fresh = ageMs < 45000;
  const okFlag = db.getMeta("last_api_ok") === "1";
  return {
    lastApiAt,
    apiOk: fresh || (okFlag && failStreak < 3),
    apiFresh: fresh,
    apiAgeSec: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
    apiFailStreak: failStreak,
    lastApiError: db.getMeta("last_api_error") || null,
    lastApiUrl: db.getMeta("last_api_url") || null,
    storage: db.isSupabase ? "supabase" : "local-json",
  };
}

app.get("/health", async (_req, res) => {
  res.json({
    ok: true,
    spins: await db.spinCount(),
    lastExtensionAt: db.getMeta("last_extension_at"),
    now: new Date().toISOString(),
    ...apiStatus(),
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
  res.json({
    metrics,
    rules: loadRules(),
    lastExtensionAt: db.getMeta("last_extension_at"),
    ...apiStatus(),
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
