# Jonbet Double Analyzer Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Local PC analyzer that captures Jonbet Double results via Brave WebSocket hook (with DOM fallback), stores history, shows dashboard, and fires Windows rule-based alerts.

**Architecture:** Chromium MV3 extension patches WebSocket on Jonbet pages and POSTs to a Node/Express localhost API backed by SQLite; dashboard + rule engine run in the same process.

**Tech Stack:** Node 24, Express, better-sqlite3, node-notifier, Manifest V3 extension.

## Global Constraints

- PC-only; loopback only (`127.0.0.1:8787`)
- No auto-betting
- Signals = configurable rules, not predictions
- Project path: `C:\Users\Admin\Documents\jonbet-double-analyzer`

## File Structure

- `server/package.json` — deps and scripts
- `server/src/index.js` — Express app
- `server/src/db.js` — SQLite schema
- `server/src/rules.js` — alert rules
- `server/src/parser.js` — heuristic WS + normalized spin parser
- `server/public/index.html` — dashboard
- `server/config/rules.json` — default rules
- `extension/manifest.json`
- `extension/background.js`
- `extension/content.js` — inject page hook
- `extension/injected.js` — WebSocket patch + DOM observer
- `extension/popup.html` / `popup.js`
- `README.md`

## Tasks

### Task 1: Server scaffold + DB + health
- [x] Create server package and SQLite schema
- [x] Health + events ingest endpoints

### Task 2: Parser + stats + rules + notifier
- [x] Heuristic parser and rule engine
- [x] Dashboard UI

### Task 3: Brave extension
- [x] WS hook + DOM fallback + popup status

### Task 4: Docs + start scripts
- [x] README in Portuguese
