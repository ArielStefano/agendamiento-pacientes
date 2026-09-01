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

// Eliminar los médicos de prueba creados con username (dr.*, edit.*, nuevo.*) y sus usuarios auth
const rows = await q(`
  SELECT pf.user_id, m.id AS medico_id, m.nombre, m.email
  FROM public.medicos m
  LEFT JOIN public.perfiles pf ON pf.medico_id = m.id
  WHERE pf.username IS NOT NULL
    AND (pf.username LIKE 'dr.%' OR pf.username LIKE 'edit.%' OR pf.username LIKE 'nuevo.%')
    AND m.email LIKE '%@clinica.local';
`);
console.log("Médicos de prueba a eliminar:", rows.length);
for (const r of rows) {
  const del = await q(`DELETE FROM auth.users WHERE id = '${r.user_id}';`);
  console.log(`  eliminado usuario auth de ${r.nombre} (${r.email})`);
}

// Eliminar pacientes de prueba con username de test
const pac = await q(`
  SELECT pf.user_id, pa.id AS paciente_id
  FROM public.pacientes pa
  LEFT JOIN public.perfiles pf ON pf.paciente_id = pa.id
  WHERE pf.username LIKE 'test.%' AND pa.email LIKE '%@clinica.local';
`);
console.log("Pacientes de prueba a eliminar:", pac.length);
for (const p of pac) {
  await q(`DELETE FROM auth.users WHERE id = '${p.user_id}';`);
  console.log(`  eliminado usuario auth de paciente test. (${p.paciente_id})`);
}
console.log("Limpieza lista.");