/**
 * Normalizes Double outcomes and extracts spins from Socket.IO / msgpack frames.
 * Jonbet (SoftSwiss): event "data" with { id: "double.tick", payload: { roll, color, status } }
 */

const { decode: msgpackDecode } = require("@msgpack/msgpack");

const COLOR_ALIASES = {
  green: "green",
  verde: "green",
  red: "green", // Blaze "red" ≡ Jonbet green
  vermelho: "green",
  lime: "green",
  black: "black",
  preto: "black",
  dark: "black",
  blue: "black",
  azul: "black",
  grey: "black",
  gray: "black",
  white: "white",
  branco: "white",
  snow: "white",
};

const NUMBER_COLOR = {
  0: "white",
  1: "green",
  2: "green",
  3: "green",
  4: "green",
  5: "green",
  6: "green",
  7: "green",
  8: "black",
  9: "black",
  10: "black",
  11: "black",
  12: "black",
  13: "black",
  14: "black",
};

function normalizeColor(value) {
  if (value == null) return null;
  if (typeof value === "number") {
    // SoftSwiss/Blaze enums: 0 white, 1 red/green, 2 black
    if (value === 0) return "white";
    if (value === 1) return "green";
    if (value === 2) return "black";
  }
  const key = String(value).trim().toLowerCase();
  if (COLOR_ALIASES[key]) return COLOR_ALIASES[key];
  if (key.includes("green") || key.includes("verde") || key.includes("red")) return "green";
  if (key.includes("white") || key.includes("branco")) return "white";
  if (key.includes("black") || key.includes("preto") || key.includes("dark")) return "black";
  return null;
}

function colorFromNumber(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const num = Number(n);
  if (NUMBER_COLOR[num]) return NUMBER_COLOR[num];
  if (num === 0) return "white";
  if (num >= 1 && num <= 7) return "green";
  if (num >= 8 && num <= 14) return "black";
  return null;
}

function spinFromDoublePayload(payload, eventId) {
  if (!payload || typeof payload !== "object") return null;
  const status = String(payload.status || "").toLowerCase();
  // Only commit finished rounds (waiting/rolling spam the socket)
  if (status && status !== "complete") return null;

  let number = payload.roll ?? payload.number ?? payload.valor ?? payload.result;
  if (number != null) number = Number(number);
  if (number == null || Number.isNaN(number) || number < 0 || number > 14) return null;

  let color = normalizeColor(payload.color ?? payload.cor);
  if (!color) color = colorFromNumber(number);

  const roundId =
    payload.id != null
      ? String(payload.id)
      : payload.round_id != null
        ? String(payload.round_id)
        : null;

  return {
    color,
    number,
    roundId,
    rolledAt: payload.updated_at || payload.created_at || payload.rolledAt || null,
    eventId: eventId || null,
  };
}

function extractFromDataObject(obj) {
  if (!obj || typeof obj !== "object") return [];
  const id = obj.id || obj.event || obj.type || null;
  const payload = obj.payload || obj.data || obj;

  // Classic SoftSwiss: { id: "double.tick", payload: {...} }
  if (id && /double/i.test(String(id))) {
    const spin = spinFromDoublePayload(payload, String(id));
    return spin ? [spin] : [];
  }

  // Nested
  if (payload && payload !== obj && typeof payload === "object") {
    if (payload.id && /double/i.test(String(payload.id)) && payload.payload) {
      const spin = spinFromDoublePayload(payload.payload, String(payload.id));
      return spin ? [spin] : [];
    }
  }

  // Direct double-shaped object
  if (payload && (payload.roll != null || payload.number != null) && payload.status) {
    const spin = spinFromDoublePayload(payload, id ? String(id) : "double");
    return spin ? [spin] : [];
  }

  return [];
}

function parseSocketIoText(raw) {
  if (typeof raw !== "string") return [];
  const trimmed = raw.trim();

  // Skip binary placeholders — real data is in the following binary frame
  if (/^45\d*-\[/.test(trimmed) && trimmed.includes("_placeholder")) return [];

  // Engine.IO MESSAGE (4) + Socket.IO EVENT (2): 42["data",{...}]
  // Also 43/440/etc. with ack ids: 430["data",...]
  const m = trimmed.match(/^\d+\["data",\s*(\{[\s\S]*\})\s*\]\s*$/);
  if (m) {
    try {
      return extractFromDataObject(JSON.parse(m[1]));
    } catch {
      return [];
    }
  }

  // Generic: 42["event", ...]
  const m2 = trimmed.match(/^\d+\["([^"]+)",\s*([\s\S]*)\]\s*$/);
  if (m2) {
    try {
      const eventName = m2[1];
      let arg = JSON.parse(m2[2]);
      if (Array.isArray(arg)) arg = arg[0];
      if (eventName === "data" || /double/i.test(eventName)) {
        return extractFromDataObject(
          eventName === "data" ? arg : { id: eventName, payload: arg }
        );
      }
    } catch {
      /* ignore */
    }
  }

  return [];
}

function decodeBinaryBase64(b64) {
  const buf = Buffer.from(b64, "base64");
  if (!buf.length) return [];

  // Try raw msgpack
  const attempts = [buf];
  // Engine.IO sometimes prefixes packet type byte (4 = message)
  if (buf[0] === 4 || buf[0] === 0x04) attempts.push(buf.subarray(1));
  // Some stacks prefix type + options
  if (buf.length > 2 && buf[0] <= 6) attempts.push(buf.subarray(1), buf.subarray(2));

  for (const slice of attempts) {
    try {
      const decoded = msgpackDecode(slice);
      const found = normalizeDecoded(decoded);
      if (found.length) return found;
    } catch {
      /* try next */
    }
  }

  // UTF-8 JSON inside binary
  try {
    const text = buf.toString("utf8").replace(/^\uFEFF/, "");
    if (text.startsWith("{") || text.startsWith("[")) {
      return normalizeDecoded(JSON.parse(text));
    }
    const spins = parseSocketIoText(text);
    if (spins.length) return spins;
  } catch {
    /* ignore */
  }

  return [];
}

function normalizeDecoded(decoded) {
  if (decoded == null) return [];

  // ["data", { id, payload }]
  if (Array.isArray(decoded)) {
    if (decoded.length >= 2 && (decoded[0] === "data" || /double/i.test(String(decoded[0])))) {
      return extractFromDataObject(
        decoded[0] === "data" ? decoded[1] : { id: decoded[0], payload: decoded[1] }
      );
    }
    // msgpack of just the object as single-element weirdness
    for (const item of decoded) {
      const f = normalizeDecoded(item);
      if (f.length) return f;
    }
    return [];
  }

  if (typeof decoded === "object") {
    return extractFromDataObject(decoded);
  }

  return [];
}

/**
 * Main entry: parse a single extension event payload into spins.
 */
function parsePayload(raw, meta = {}) {
  if (raw == null) return [];

  if (meta.binaryBase64) {
    return decodeBinaryBase64(meta.binaryBase64);
  }

  if (typeof raw === "object" && raw.binaryBase64) {
    return decodeBinaryBase64(raw.binaryBase64);
  }

  if (typeof raw === "string") {
    // Never run loose heuristics on binary-looking garbage
    if (raw.includes("\uFFFD") || /[\x00-\x08\x0e-\x1f]/.test(raw)) return [];
    return parseSocketIoText(raw);
  }

  if (typeof raw === "object") {
    return extractFromDataObject(raw);
  }

  return [];
}

function normalizeIncomingSpin(spin) {
  if (!spin) return null;
  let color = normalizeColor(spin.color);
  let number = spin.number != null ? Number(spin.number) : null;
  if (!color && number != null) color = colorFromNumber(number);
  if (!color) return null;
  if (number == null || Number.isNaN(number)) number = color === "white" ? 0 : -1;
  if (number < 0 || number > 14) return null;
  if (!color) color = colorFromNumber(number);
  if (!color) return null;
  return {
    color,
    number,
    roundId: spin.roundId ? String(spin.roundId) : null,
    rolledAt: spin.rolledAt || null,
  };
}

module.exports = {
  parsePayload,
  normalizeIncomingSpin,
  normalizeColor,
  colorFromNumber,
  NUMBER_COLOR,
  decodeBinaryBase64,
  parseSocketIoText,
};
