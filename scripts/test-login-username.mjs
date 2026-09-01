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
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const URL = process.env.SUPABASE_URL;
const REST = `${URL}/rest/v1`;

async function rpc(name, body, token) {
  const h = { apikey: KEY, "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${REST}/rpc/${name}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json() };
}
async function login(id, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: id, password: pw }) });
  return { ok: r.ok, data: await r.json() };
}

let failures = 0;
function check(n, ok, x = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!ok) failures++; }

// admin por username
const ra = await rpc("resolver_email_por_usuario", { p_input: "admin" });
check("resolver('admin') OK", ra.ok && ra.data === "admin@clinica.com", JSON.stringify(ra.data));
const la = await login("admin@clinica.com", "admin123");
check("login admin", la.ok);

// jtoaquiza (medico) por username
const rm = await rpc("resolver_email_por_usuario", { p_input: "jtoaquiza" });
check("resolver('jtoaquiza') OK", rm.ok && rm.data === "jtoaquiza@clinica.com", JSON.stringify(rm.data));

// username no existe → null
const rn = await rpc("resolver_email_por_usuario", { p_input: "noexiste123" });
check("resolver('noexiste123') = null", rn.ok && rn.data == null, JSON.stringify(rn.data));

// email directo
const re = await rpc("resolver_email_por_usuario", { p_input: "admin@clinica.com" });
check("resolver(email) pasa directo", re.ok && re.data === "admin@clinica.com", JSON.stringify(re.data));

// Anon (sin token) puede llamar resolver (login está deslogueado)
const anon = await fetch(`${REST}/rpc/resolver_email_por_usuario`, {
  method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ p_input: "admin" }),
});
const anonData = await anon.json();
check("resolver accesible sin sesión (anon)", anon.ok && anonData === "admin@clinica.com", `${anon.status} ${JSON.stringify(anonData)}`);

// Crear médico por username como admin (similar a la pantalla medicos.html)
const adminLogin = await login("admin@clinica.com", "admin123");
const token = adminLogin.data.access_token;
const u = Math.random().toString(36).slice(2, 8);
const mk = await rpc("crear_medico_admin", {
  p_nombre: "Dr. Username Test", p_especialidad: "General", p_telefono: null,
  p_email: null, p_dias: ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"],
  p_hora_inicio: "08:00", p_hora_fin: "13:00", p_duracion: 30,
  p_contrasena: "Test1234", p_username: `dr.${u}`,
}, token);
console.log(`  → crear_medico_admin status=${mk.status} data=${JSON.stringify(mk.data)}`);
check("crear_medico_admin con username", mk.ok, JSON.stringify(mk.data));
const emailMed = mk.data?.email;
check("email médico = username@clinica.local", mk.ok && emailMed === `dr.${u}@clinica.local`, emailMed);

// Login del médico por username
if (mk.ok && emailMed) {
  const lm = await login(emailMed, "Test1234");
  check("login médico por email generado", lm.ok);
}

// Verificar username guardado en perfiles del médico
if (mk.ok && mk.data?.medico_id) {
  const rp = await rpc("verificar_username_medico", {}, token);
  // fallback: usar query directa
  const rURL = `${REST}/perfiles?select=username&medico_id=eq.${mk.data.medico_id}`;
  const rr = await fetch(rURL, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  const pData = await rr.json();
  check("perfiles.username del médico guardado", rr.ok && pData[0]?.username === `dr.${u}`, JSON.stringify(pData));
}

console.log(failures ? `\n${failures} fallos` : "\nTodo OK");
process.exit(failures ? 1 : 0);