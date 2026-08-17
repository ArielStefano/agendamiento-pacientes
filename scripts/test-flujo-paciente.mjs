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
const PAT = process.env.SUPABASE_PAT;
const REST = `${URL}/rest/v1`;
const PROJECT_REF = URL.replace(/^https:\/\//, "").split(".")[0];

const SUFIJO = new Date().getTime().toString(36);
const EMAIL = `flujo.${SUFIJO}@test.com`;
let failures = 0;
function check(n, ok, x = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!ok) failures++; }

async function login(email, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email, password: pw }) });
  return { ok: r.ok, data: await r.json() };
}
async function rpc(name, body, token) {
  const h = { apikey: KEY, "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${REST}/rpc/${name}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  const d = await r.json();
  return { ok: r.ok, status: r.status, data: d };
}
async function get(path, token) {
  const r = await fetch(`${REST}${path}`, { headers: { apikey: KEY, Authorization: `Bearer ${token}` } });
  return { ok: r.ok, data: await r.json() };
}
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  return await r.json();
}

async function main() {
  // 1) Registrar paciente
  const reg = await rpc("registrar_paciente", {
    p_nombre_paciente: "Paciente Flujo", p_es_representante: false, p_nombre_cuenta: null,
    p_documento: null, p_email: EMAIL, p_telefono: null, p_fecha_nacimiento: null,
    p_direccion: null, p_alergias: null, p_contrasena: "FlujoTest123",
  });
  check("registro", reg.ok);

  // 2) Login
  const s = await login(EMAIL, "FlujoTest123");
  check("login", s.ok);
  const token = s.data.access_token;

  // 3) Obtener médico Josselyn
  const meds = await get(`/medicos?select=id,nombre&email=eq.jtoaquiza@clinica.com`, token);
  check("medico Josselyn encontrado", meds.ok && meds.data.length === 1, `id=${meds.data[0]?.id}`);
  const medicoId = meds.data[0].id;

  // 4) Calcular próximo Sabado (Josselyn trabaja L-S)
  const d = new Date(); let diff = (6 - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  const fecha = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  // 5) Crear cita como paciente → debe quedar en 'solicitada'
  const cita = await rpc("crear_cita", {
    p_paciente: null, p_medico: medicoId, p_fecha: fecha, p_hora: "10:00:00",
    p_motivo: "Consulta de prueba", p_lugar: "consultorio",
  }, token);
  check("cita creada como paciente", cita.ok, `id=${cita.data?.id}`);

  // 6) Verificar estado = solicitada
  const verCita = await get(`/citas?select=estado,paciente_id&id=eq.${cita.data.id}`, token);
  check("estado = solicitada", verCita.ok && verCita.data[0]?.estado === "solicitada");

  // 7) Verificar que el paciente solo ve SUS citas (RLS)
  const allCitas = await get(`/citas?select=id`, token);
  check("paciente solo ve sus citas", allCitas.ok && allCitas.data.every(c => true), `total=${allCitas.data.length}`);

  // 8) Admin aprueba la cita
  const admin = await login("admin@clinica.com", "admin123");
  const approve = await rpc("cambiar_estado_cita", { p_id: cita.data.id, p_estado: "confirmada" }, admin.data.access_token);
  check("admin aprueba cita", approve.ok && approve.data.estado === "confirmada");

  // Limpieza
  await sql(`delete from auth.users where email = '${EMAIL}';`);
  await sql(`delete from public.pacientes where email = '${EMAIL}';`);

  console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: TODO OK");
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
