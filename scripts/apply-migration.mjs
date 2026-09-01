import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    const content = readFileSync(".env", "utf8");
    for (const line of content.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
loadEnv();

const PAT = process.env.SUPABASE_PAT;
const PROJECT = "xgfwcrdrkzcoxepnicfb";

async function runSQL(sql) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json", apikey: PAT },
    body: JSON.stringify({ query: sql }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(d)}`);
  return d;
}

const sql = readFileSync("supabase/migracion-username.sql", "utf8");

// Split by top-level statements (empty lines separate them)
const blocks = sql.split(/\n-- \d+\)/);

for (const block of blocks) {
  const trimmed = block.trim();
  if (!trimmed || trimmed.startsWith("--")) continue;
  const first80 = trimmed.substring(0, 80).replace(/\n/g, " ");
  try {
    await runSQL(trimmed);
    console.log(`OK: ${first80}...`);
  } catch (err) {
    console.error(`FAIL: ${first80}...\n  ${err.message}`);
  }
}

console.log("Migration complete.");
