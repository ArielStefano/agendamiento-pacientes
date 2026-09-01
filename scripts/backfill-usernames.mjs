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

async function q(sql) {
  const r = await fetch("https://api.supabase.com/v1/projects/xgfwcrdrkzcoxepnicfb/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json", apikey: PAT },
    body: JSON.stringify({ query: sql }),
  });
  return r.json();
}

// Get existing perfiles sin username con su email auth
const rows = await q(`
  SELECT pf.user_id, pf.nombre, pf.rol, COALESCE(au.email, '') AS email,
         COALESCE(pf.username, '') AS username
  FROM public.perfiles pf
  LEFT JOIN auth.users au ON au.id = pf.user_id
  ORDER BY pf.created_at;
`);
console.log("Perfiles actuales:");
for (const r of rows) console.log(`  ${r.rol} | ${r.email || "(sin email)"} | user=${r.user_id} | username=${r.username || "(ninguno)"}`);

const usados = new Set(rows.map(r => r.username).filter(Boolean));

for (const r of rows) {
  if (r.username) continue;
  let base = (r.email.split("@")[0] || "usuario").toLowerCase().replace(/[^a-z0-9._-]/g, "").substring(0, 30);
  if (!base || base.length < 3) base = `${r.rol}.${r.user_id.substring(0, 6)}`;
  let cand = base;
  let i = 1;
  while (usados.has(cand)) { cand = `${base}${++i}`; }
  usados.add(cand);
  const upd = await q(`UPDATE public.perfiles SET username = '${cand}' WHERE user_id = '${r.user_id}' AND username IS NULL;`);
  console.log(`  → asignado username '${cand}' a ${r.nombre} (${r.rol})`);
}
console.log("Listo.");