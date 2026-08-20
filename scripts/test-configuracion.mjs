#!/usr/bin/env node
"use strict";

const SUPABASE_URL = "https://xgfwcrdrkzcoxepnicfb.supabase.co";
const ANON_KEY = "sb_publishable_xQtBw6keFlyfmOh5faQ76w_AT2n-6U9";
const PAT = process.env.SUPABASE_PAT || "";

let passed = 0;
let failed = 0;

function assert(label, ok, detail) {
  if (ok) { passed++; console.log(`  PASS  ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? " — " + detail : ""}`); }
}

async function managementQuery(query) {
  const resp = await fetch("https://api.supabase.com/v1/projects/xgfwcrdrkzcoxepnicfb/database/query", {
    method: "POST",
    headers: { "Authorization": `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  return resp.json();
}

async function rpc(fn, params, token) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${token || ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params || {}),
  });
  const text = await resp.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch {} }
  return { ok: resp.ok, data };
}

async function get(table, query, token) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      "apikey": ANON_KEY,
      "Authorization": `Bearer ${token || ANON_KEY}`,
      "Range": "0-99",
    },
  });
  const data = await resp.json();
  return { ok: resp.ok, data };
}

// Login
async function login(email, pass) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "apikey": ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: pass }),
  });
  const data = await resp.json();
  return data.access_token;
}

console.log("=== TEST CONFIGURACION ===\n");

// 1. Login admin
console.log("=== 1. SETUP ===");
const adminToken = await login("admin@clinica.com", "admin123");
assert("admin login", !!adminToken);

// 2. Leer configuracion via RPC
console.log("\n=== 2. LEER CONFIGURACION ===");
const configRes = await rpc("leer_configuracion", {}, adminToken);
assert("leer_configuracion OK", configRes.ok, JSON.stringify(configRes.data));

const configs = {};
for (const row of (configRes.data || [])) {
  configs[row.clave] = row.valor;
}
assert("anonimizar_pacientes existe", "anonimizar_pacientes" in configs);
assert("anonimizar_pacientes = true", configs["anonimizar_pacientes"] === true);
assert("duracion_default_min existe", "duracion_default_min" in configs);
assert("duracion_default_min = 30", configs["duracion_default_min"] === 30);
assert("clinica_nombre existe", "clinica_nombre" in configs);
assert("clinica_nombre = CliniAgenda", configs["clinica_nombre"] === "CliniAgenda");
assert("buffer_default_min = 30", configs["buffer_default_min"] === 30);
assert("recordatorios_horas_antes = 24", configs["recordatorios_horas_antes"] === 24);

// 3. Guardar configuracion (admin)
console.log("\n=== 3. GUARDAR CONFIGURACION ===");
const saveRes = await rpc("guardar_configuracion_admin", {
  p_clave: "clinica_nombre",
  p_valor: "Clínica Test"
}, adminToken);
assert("guardar_configuracion_admin OK", saveRes.ok, JSON.stringify(saveRes.data));

// 4. Verificar cambio
console.log("\n=== 4. VERIFICAR CAMBIO ===");
const verifyRes = await rpc("leer_configuracion", {}, adminToken);
const verifyConfigs = {};
for (const row of (verifyRes.data || [])) {
  verifyConfigs[row.clave] = row.valor;
}
assert("clinica_nombre cambiado", verifyConfigs["clinica_nombre"] === "Clínica Test", `actual=${verifyConfigs["clinica_nombre"]}`);

// 5. Restaurar valor original
await rpc("guardar_configuracion_admin", {
  p_clave: "clinica_nombre",
  p_valor: "CliniAgenda"
}, adminToken);
assert("clinica_nombre restaurado", true);

// 6. Batch save
console.log("\n=== 5. BATCH SAVE ===");
const batchRes = await rpc("guardar_configuracion_batch_admin", {
  p_claves: ["duracion_default_min", "buffer_default_min"],
  p_valores: [45, 45]
}, adminToken);
assert("batch save OK", batchRes.ok, JSON.stringify(batchRes.data));

const batchVerify = await rpc("leer_configuracion", {}, adminToken);
const batchConfigs = {};
for (const row of (batchVerify.data || [])) {
  batchConfigs[row.clave] = row.valor;
}
assert("duracion = 45 after batch", batchConfigs["duracion_default_min"] === 45);
assert("buffer = 45 after batch", batchConfigs["buffer_default_min"] === 45);

// Restore
await rpc("guardar_configuracion_batch_admin", {
  p_claves: ["duracion_default_min", "buffer_default_min"],
  p_valores: [30, 30]
}, adminToken);
assert("valores restaurados", true);

// 7. RPC por paciente (debe fallar o ser ignorado)
console.log("\n=== 6. PACIENTE NO PUEDE ESCRIBIR ===");
const pacToken = await login("paciente@test.com", "123456");
const pacSave = await rpc("guardar_configuracion_admin", {
  p_clave: "test_no_permiso",
  p_valor: "fail"
}, pacToken);
assert("paciente NO puede guardar config", !pacSave.ok, JSON.stringify(pacSave.data));

// 8. RPC sin auth
console.log("\n=== 7. SIN AUTH ===");
const noAuthRes = await rpc("leer_configuracion", {}, null);
assert("sin auth puede leer config", noAuthRes.ok, "RLS permite SELECT a todos");

// 9. Verificar RLS en tabla
console.log("\n=== 8. VERIFICAR TABLA ===");
const tblCheck = await managementQuery("SELECT clave, valor FROM configuracion ORDER BY clave");
assert("tabla tiene 7 registros", Array.isArray(tblCheck) && tblCheck.length === 7, `count=${tblCheck?.length}`);

// 10. Verificar RPCs existen
console.log("\n=== 9. VERIFICAR RPCs ===");
const rpcCheck = await managementQuery(`
  SELECT routine_name FROM information_schema.routines
  WHERE routine_name IN ('leer_configuracion', 'guardar_configuracion_admin', 'guardar_configuracion_batch_admin')
  AND routine_schema = 'public'
`);
assert("3 RPCs existen", Array.isArray(rpcCheck) && rpcCheck.length === 3, `found=${rpcCheck?.length}`);

console.log("\n" + "═".repeat(50));
console.log(`RESULTADO: ${failed === 0 ? "✅ TODO OK" : "❌ " + failed + " fallo(s)"} (${passed} pass, ${failed} fail)`);
