const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const out = execSync(
  "supabase projects api-keys --project-ref aclulovomzyrvyeittxt -o env",
  { encoding: "utf8" }
);
const map = {};
for (const line of out.split(/\r?\n/)) {
  const m = line.match(/^(SUPABASE_[A-Z_]+)=\"(.*)\"$/);
  if (m) map[m[1]] = m[2];
}

if (!map.SUPABASE_SERVICE_ROLE_KEY || !map.SUPABASE_ANON_KEY) {
  console.error("Não consegui ler as keys do Supabase CLI");
  process.exit(1);
}

const envPath = path.join(__dirname, "..", "server", ".env");
const body = [
  "SUPABASE_URL=https://aclulovomzyrvyeittxt.supabase.co",
  `SUPABASE_SERVICE_ROLE_KEY=${map.SUPABASE_SERVICE_ROLE_KEY}`,
  `SUPABASE_ANON_KEY=${map.SUPABASE_ANON_KEY}`,
  "POLL_MS=2000",
  "PORT=8787",
  "HOST=127.0.0.1",
  "",
].join("\n");

fs.writeFileSync(envPath, body, "utf8");
console.log("Escrito", envPath);
