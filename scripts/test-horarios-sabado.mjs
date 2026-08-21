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
async function sql(q) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, { method: "POST", headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) });
  return await r.json();
}

async function main() {
  // Login admin
  const a = await login("admin@clinica.com", "admin123");
  check("admin login", a.ok);
  const token = a.data.access_token;

  // === TEST: Crear paciente via RPC ===
  const nombre = `Paciente RPC ${Date.now()}`;
  const crear = await rpc("crear_paciente_admin", {
    p_nombre: nombre, p_documento: "12345", p_email: "rpc@test.com",
    p_telefono: "099999", p_fecha_nacimiento: null, p_direccion: null,
    p_alergias: null, p_notas: "test",
  }, token);
  check("crear_paciente_admin", crear.ok && crear.data?.ok, `id=${crear.data?.id}`);
  const pacienteId = crear.data?.id;

  // === TEST: Actualizar paciente via RPC ===
  const actualizar = await rpc("actualizar_paciente_admin", {
    p_id: pacienteId, p_nombre: nombre + " MOD", p_documento: "12345",
    p_email: "rpc@test.com", p_telefono: "088888", p_fecha_nacimiento: null,
    p_direccion: "Calle 123", p_alergias: null, p_notas: "actualizado",
  }, token);
  check("actualizar_paciente_admin", actualizar.ok && actualizar.data?.ok);

  // Verify via direct query
  const ver = await sql(`select nombre, telefono, direccion, notas from public.pacientes where id = '${pacienteId}';`);
  check("datos actualizados", ver[0]?.nombre?.includes("MOD") && ver[0]?.telefono === "088888" && ver[0]?.direccion === "Calle 123");

  // === TEST: Josselyn sabado hours ===
  const joss = await sql(`select hora_inicio_sabado, hora_fin_sabado from public.medicos where email = 'jtoaquiza@clinica.com';`);
  check("Josselyn sabado hours", joss[0]?.hora_inicio_sabado === "08:00:00" && joss[0]?.hora_fin_sabado === "17:00:00");

  // === TEST: Crear cita sabado via RPC ===
  const d = new Date(); let diff = (6 - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  const sabado = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

  const medicoId = "7fa57aec-8e39-4fe0-b2bb-bebd72d0d251";
  const citaSab = await rpc("crear_cita", {
    p_paciente: pacienteId, p_medico: medicoId, p_fecha: sabado,
    p_hora: "10:00:00", p_motivo: "Test sábado", p_lugar: "Consultorio",
  }, token);
  check("cita sabado 10:00 OK", citaSab.ok, `id=${citaSab.data?.id}`);

  // === TEST: Cita sabado fuera de horario sabado debería fallar ===
  const citaSabBad = await rpc("crear_cita", {
    p_paciente: pacienteId, p_medico: medicoId, p_fecha: sabado,
    p_hora: "18:00:00", p_motivo: "Test fuera horario", p_lugar: "consultorio",
  }, token);
  check("cita sabado 18:00 RECHAZADA", !citaSabBad.ok);

  // Cleanup
  await sql(`delete from public.recordatorios where cita_id in (select id from public.citas where paciente_id = '${pacienteId}');`);
  await sql(`delete from public.citas where paciente_id = '${pacienteId}';`);
  await sql(`delete from public.pacientes where id = '${pacienteId}';`);
  await sql(`delete from auth.users where email = 'rpc@test.com';`);

  console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: TODO OK");
  process.exit(failures ? 1 : 0);
}
main().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
