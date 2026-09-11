const { execSync } = require("child_process");
const fs = require("fs");

const out = execSync(
  "supabase projects api-keys --project-ref aclulovomzyrvyeittxt -o env",
  { encoding: "utf8" }
);
const map = {};
for (const line of out.split(/\r?\n/)) {
  const m = line.match(/^(SUPABASE_[A-Z_]+)=\"(.*)\"$/);
  if (m) map[m[1]] = m[2];
}

const body = [
  { key: "SUPABASE_URL", value: "https://aclulovomzyrvyeittxt.supabase.co" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", value: map.SUPABASE_SERVICE_ROLE_KEY },
  { key: "POLL_MS", value: "2000" },
  { key: "NODE_VERSION", value: "20" },
];

const path = require("path").join(process.env.TEMP, "render-env.json");
fs.writeFileSync(path, JSON.stringify(body));
console.log("wrote", path, "keys", body.map((b) => b.key).join(","), "srLen", (map.SUPABASE_SERVICE_ROLE_KEY || "").length);
