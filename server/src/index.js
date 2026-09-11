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
  // Considera online se sync recente (<45s), mesmo com falha pontual
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
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    spins: db.spinCount(),
    lastExtensionAt: db.getMeta("last_extension_at"),
    now: new Date().toISOString(),
    ...apiStatus(),
  });
});

app.post("/events", (req, res) => {
  touchHeartbeat();
  const body = req.body || {};
  const receivedAt = body.receivedAt || new Date().toISOString();
  const source = body.source || "unknown";
  const wsUrl = body.url || body.wsUrl || null;
  const saveRaw = body.saveRaw === true;

  let inserted = 0;
  const alerts = [];
  const candidates = [];

  // Snapshot da API (extensão / background) — caminho paralelo ao poller
  if (Array.isArray(body.games) && body.games.length) {
    inserted += ingestGames(db, body.games, body.apiUrl || "extension-api", source || "extension-api");
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
        db.insertRaw({
          receivedAt,
          wsUrl,
          payload: `[binary decoded] ${decodedSpins}`,
        });
      } catch {
        /* ignore */
      }
    } else if (saveRaw && typeof body.raw === "string" && /double\.tick|"roll"/i.test(body.raw)) {
      try {
        db.insertRaw({ receivedAt, wsUrl, payload: body.raw });
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
    const ok = db.insertSpin({
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
    const metrics = computeMetrics(db.recentSpins(200));
    const fired = maybeAlert(metrics, loadRules());
    if (fired) alerts.push(fired);
  }

  res.json({ ok: true, inserted, alerts });
});

app.post("/api/reset", (_req, res) => {
  db.reset();
  res.json({ ok: true });
});

app.get("/api/spins", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ data: db.recentSpins(limit) });
});

app.get("/api/stats", (_req, res) => {
  const spins = db.recentSpins(500);
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

app.get("/api/raw", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ data: db.recentRaw(limit) });
});

startPoller(db, {
  onInsert: (inserted) => {
    if (inserted > 0) {
      const metrics = computeMetrics(db.recentSpins(200));
      maybeAlert(metrics, loadRules());
    }
  },
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Jonbet Double Analyzer → http://127.0.0.1:${PORT}`);
  console.log("Poller API Double resiliente (retry + fallback + extensão)");
});
