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
const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const REST = `${URL}/rest/v1`;
const SUFIJO = new Date().getTime().toString(36);
const USERNAME = `test.${SUFIJO}`;
let failures = 0;
function check(n, ok, x = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!ok) failures++; }

async function rpc(name, body, token) {
  const h = { apikey: KEY, "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${REST}/rpc/${name}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  const d = await r.json();
  return { ok: r.ok, status: r.status, data: d };
}
async function login(id, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: id, password: pw }) });
  return { ok: r.ok, data: await r.json() };
}

// 1) Registrar paciente SOLO con username (sin email)
const reg = await rpc("registrar_paciente", {
  p_nombre_paciente: "Paciente Username", p_es_representante: false, p_nombre_cuenta: null,
  p_documento: null, p_email: null, p_telefono: null, p_fecha_nacimiento: null,
  p_direccion: null, p_alergias: null, p_contrasena: "PassTest123", p_username: USERNAME,
});
console.log(`  → registrar status=${reg.status} data=${JSON.stringify(reg.data)}`);
check("registro con username", reg.ok, JSON.stringify(reg.data));
const emailGenerado = reg.data?.email;
check("email generado = username@clinica.local", reg.ok && emailGenerado === `${USERNAME}@clinica.local`, emailGenerado);

// 2) Resolver username → email (como hace el frontend)
const resuelto = await rpc("resolver_email_por_usuario", { p_input: USERNAME });
check("resolver_email_por_usuario OK", resuelto.ok && resuelto.data === `${USERNAME}@clinica.local`, JSON.stringify(resuelto.data));

// 3) Login por email resuelto
const sUser = await login(resuelto.data, "PassTest123");
check("login por username (resuelto)", sUser.ok, sUser.ok ? "OK" : JSON.stringify(sUser.data));

// 4) Login por email generado
const sEmail = await login(emailGenerado, "PassTest123");
check("login por email generado", sEmail.ok);

// 5) Duplicado: mismo username debe fallar
const dup = await rpc("registrar_paciente", {
  p_nombre_paciente: "Otro", p_es_representante: false, p_nombre_cuenta: null,
  p_documento: null, p_email: null, p_telefono: null, p_fecha_nacimiento: null,
  p_direccion: null, p_alergias: null, p_contrasena: "PassTest123", p_username: USERNAME,
});
check("username duplicado rechazado", !dup.ok, dup.status === 400 ? "400 OK" : `status=${dup.status}`);

console.log(failures ? `\n${failures} fallos` : "\nTodo OK");
process.exit(failures ? 1 : 0);