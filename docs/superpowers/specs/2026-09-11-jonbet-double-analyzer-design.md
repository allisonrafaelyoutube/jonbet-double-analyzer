# Jonbet Double Analyzer — Design Spec

**Date:** 2026-09-11  
**Status:** Approved in conversation; awaiting user review of this written spec  
**Owner:** Allison Rafael (uso pessoal, PC local)

## 1. Goal

Local analyzer for Jonbet **Double** that:

1. Captures round results from the **same WebSocket/API traffic** the Brave tab already receives.
2. Stores history and shows a simple dashboard on the PC.
3. Sends **rule-based desktop alerts** (not “predictions that beat the house”).

Out of scope for MVP: auto-betting, clicking the site, multi-user, selling signals, cloud hosting.

## 2. Constraints and honesty

- Double is RNG with house edge. Historical streaks do not create a mathematical edge.
- “Sinais” = user-defined alerts (e.g. N spins without white), not guaranteed tips.
- Capture only while the user is logged in and the Double page is open in Brave.
- Undocumented WS payloads can change; the app must tolerate unknown messages and support a raw capture mode for remapping.

## 3. Architecture

```
Brave (jonbet.com Double)
    → Extension (hooks WebSocket / related fetch if needed)
        → POST http://127.0.0.1:8787/events
            → Local API (Node)
                → SQLite
                → Rule engine
                → Desktop notification + optional beep
            → Dashboard http://127.0.0.1:8787/
```

**Stack (MVP):**

| Piece | Choice | Why |
|-------|--------|-----|
| Extension | Manifest V3 Chromium (Brave) | Native WS access in-page |
| Local server | Node.js + Express | Simple localhost API + static UI |
| DB | SQLite (`better-sqlite3`) | Zero setup, file-local |
| UI | Single HTML/CSS/JS page served by the API | No separate frontend build for MVP |
| Alerts | `node-notifier` (Windows toast) + optional sound | PC-only, as requested |

Project root: `C:\Users\Admin\Documents\jonbet-double-analyzer\`

## 4. Components

### 4.1 Brave extension (`extension/`)

- Permissions: host access limited to Jonbet Double origins (exact host list finalized during WS discovery; start with `*://*.jonbet.com/*`).
- Content script / injected page script:
  - Patches `window.WebSocket` (constructor + `send` / `onmessage` / `addEventListener('message')`).
  - Optionally logs interesting `fetch`/`XHR` URLs that look like game history (secondary).
- Forwards parsed or raw frames to the background service worker → `http://127.0.0.1:8787/events`.
- UI in extension popup:
  - Connection status (server reachable? last event age?)
  - Toggle: **Raw capture** vs **Parsed only**
  - Button: open dashboard

**Security:** events only go to loopback. No remote telemetry.

### 4.2 Local API (`server/`)

Endpoints:

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/` | Dashboard |
| `GET` | `/health` | Extension health check |
| `POST` | `/events` | Ingest WS payloads / parsed results |
| `GET` | `/api/spins?limit=` | Recent spins |
| `GET` | `/api/stats` | Aggregates |
| `GET` | `/api/rules` | Current alert rules |
| `PUT` | `/api/rules` | Update rules |
| `GET` | `/api/raw?limit=` | Recent raw frames (discovery mode) |

Ingest accepts:

```json
{
  "source": "websocket",
  "url": "wss://...",
  "receivedAt": "ISO-8601",
  "raw": "<string or object>",
  "spin": {
    "color": "green|black|white",
    "number": 0,
    "roundId": "optional",
    "rolledAt": "optional ISO-8601"
  }
}
```

If `spin` is present and valid → insert into `spins` (dedupe by `roundId` or by `(rolledAt, color, number)` window).  
Always optionally store `raw` when raw mode is on.

### 4.3 Data model (SQLite)

**`spins`**

- `id` INTEGER PK
- `round_id` TEXT NULL UNIQUE
- `color` TEXT NOT NULL  -- green | black | white
- `number` INTEGER NOT NULL
- `rolled_at` TEXT NOT NULL
- `received_at` TEXT NOT NULL
- `source_url` TEXT NULL

**`raw_events`**

- `id` INTEGER PK
- `received_at` TEXT NOT NULL
- `ws_url` TEXT NULL
- `payload` TEXT NOT NULL

**`rules`** (single-row JSON or key/value)

Default rules file `config/rules.json`:

```json
{
  "whiteGap": { "enabled": true, "threshold": 15 },
  "sameColorStreak": { "enabled": true, "threshold": 5 },
  "cooldownSeconds": 60
}
```

### 4.4 Rule engine

On each new spin:

1. Recompute metrics (spins since last white, current same-color streak, frequencies last 50/100).
2. If a rule fires and cooldown elapsed → Windows notification + log in UI.
3. Never place bets or call Jonbet write APIs.

### 4.5 Dashboard

Single page sections:

- Live status (extension last ping, last spin)
- History strip (colors like the game)
- Stats: % green / black / white, max gaps, current gaps
- Rules editor (thresholds + enable toggles)
- Raw log viewer (for mapping WS schema)

## 5. WS discovery plan (phase 0)

Until Jonbet’s payload schema is known:

1. Run server + extension with **raw capture ON**.
2. User opens Double in Brave, waits through several full rounds (waiting → spinning → result).
3. Inspect `raw_events` for messages that correlate with new history tiles.
4. Write a parser module `server/parsers/jonbet-double.js` with fixtures from captured samples.
5. Switch to parsed mode; keep raw capture available as fallback.

Color mapping (from UI observation; confirm against WS):

- Green → x2  
- Black/dark → x2  
- White (number **14**) → x14  

Exact number→color table will be locked from captures (e.g. 0–14 wheel layout if present in payload).

## 6. Error handling

- Server down: extension shows “servidor offline”; queues nothing durable in MVP (avoid unbounded memory); retries next message.
- Malformed payload: store as raw if enabled; skip spin insert.
- Duplicate spin: ignore via UNIQUE / dedupe logic.
- Jonbet changes WS format: dashboard banner “parser miss rate high” + re-enable raw capture.

## 7. Setup (user)

1. Install Node.js LTS.
2. `npm install` in `server/`.
3. `npm start` → dashboard at `http://127.0.0.1:8787`.
4. In Brave: Load unpacked extension from `extension/`.
5. Open Jonbet Double; pin extension; confirm health green.
6. Play/watch a few rounds; verify spins appear.

## 8. Testing

- Unit: parser fixtures (green/black/white samples).
- Unit: rule engine (gap/streak/cooldown).
- Manual: extension + live page (user session).
- Manual: notification fires once per cooldown.

## 9. Implementation phases

1. **Scaffold** server health + SQLite + empty dashboard.  
2. **Extension** WS hook + POST raw events.  
3. **Discovery** capture session → write parser.  
4. **Spins + stats UI**.  
5. **Rules + Windows notifications**.  
6. **Polish** README, start scripts, default rules.

## 10. Non-goals (explicit)

- Automating bets or Auto mode on Jonbet  
- Claiming predictive accuracy  
- Mobile / Telegram (deferred; user chose PC-only)  
- Official Jonbet partnership API
