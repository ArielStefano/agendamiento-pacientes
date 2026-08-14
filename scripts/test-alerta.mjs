import { readFileSync } from "node:fs";

function loadEnv() {
  try {
    const content = readFileSync(".env", "utf8");
    for (const line of content.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* sin .env */
  }
}
loadEnv();

const URL = process.env.SUPABASE_URL;
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY;
const REST = `${URL}/rest/v1`;

const PSICOLOGA_MEDICO = "7fa57aec-8e39-4fe0-b2bb-bebd72d0d251";
const PACIENTE = "20000000-0000-4000-8000-000000000001";
const ADMIN_USER_ID = "2f3d0427-7cfa-4e9b-b6be-96ff2a795f97";

let failures = 0;
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
  if (!ok) failures++;
}

async function login(email, password) {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(data)}`);
  return data.access_token;
}

async function post(path, body, token) {
  const res = await fetch(`${REST}${path}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function get(path, token) {
  const res = await fetch(`${REST}${path}`, {
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function del(path, token) {
  const res = await fetch(`${REST}${path}`, {
    method: "DELETE",
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
}

function nextSabado() {
  const d = new Date();
  let day = d.getDay();
  let diff = (6 - day + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const adminToken = await login("admin@clinica.com", "admin123");
  const carlosToken = await login("carlos@clinica.com", "medico123");

  const fecha = nextSabado();
  const cita = await post(
    "/rpc/crear_cita",
    {
      p_paciente: PACIENTE,
      p_medico: PSICOLOGA_MEDICO,
      p_fecha: fecha,
      p_hora: "07:00:00",
      p_motivo: "Cita prueba alerta",
      p_lugar: "domicilio",
    },
    adminToken
  );
  check("cita creada con lugar", cita.id && cita.lugar === "domicilio", `lugar=${cita.lugar}`);

  const citas = await get(
    `/citas?select=id,fecha,hora,lugar,medico_id&id=eq.${cita.id}&medico_id=eq.${PSICOLOGA_MEDICO}`,
    adminToken
  );
  check("cita guardada para la psicóloga", citas.length === 1 && citas[0].lugar === "domicilio");

  const recs = await get(`/recordatorios?select=*&cita_id=eq.${cita.id}&order=created_at`, adminToken);
  const alerta = recs.find((r) => r.dirigido_a === ADMIN_USER_ID);
  check("alerta de admin creada", !!alerta, `total=${recs.length}`);
  if (alerta) {
    check(
      "mensaje incluye lugar y autor",
      alerta.mensaje.includes("a domicilio") && alerta.mensaje.includes("Agendada por"),
      alerta.mensaje
    );
  }
  const appRec = recs.find((r) => r.canal === "app" && r.dirigido_a === null);
  const emailRec = recs.find((r) => r.canal === "email");
  check("recordatorio app del paciente", !!appRec);
  check("recordatorio email del paciente", !!emailRec);

  const recsCarlos = await get(`/recordatorios?select=id,dirigido_a&cita_id=eq.${cita.id}`, carlosToken);
  check(
    "médico NO ve la alerta de admin (RLS)",
    recsCarlos.length === 2 && !recsCarlos.some((r) => r.dirigido_a === ADMIN_USER_ID),
    `visible para Carlos=${recsCarlos.length}`
  );

  await del(`/citas?id=eq.${cita.id}`, adminToken);
  const despues = await get(`/recordatorios?select=id&cita_id=eq.${cita.id}`, adminToken);
  check("limpieza: recordatorios eliminados en cascada", despues.length === 0);

  console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: TODO OK");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
