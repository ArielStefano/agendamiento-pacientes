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
const PAT = process.env.SUPABASE_PAT;
const REST = `${URL}/rest/v1`;
const PROJECT_REF = URL.replace(/^https:\/\//, "").split(".")[0];

const PACIENTE = "20000000-0000-4000-8000-000000000001";
const EMAIL = "prueba.doctor@clinica.com";
const CLAVE1 = "DoctorTest123";
const CLAVE2 = "DoctorNueva456";

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
  return { ok: res.ok, data };
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

async function managementQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`SQL: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

function nextSabado() {
  const d = new Date();
  let diff = (6 - d.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const admin = await login("admin@clinica.com", "admin123");
  check("login admin", admin.ok);
  if (!admin.ok) {
    console.error(JSON.stringify(admin.data));
    process.exit(1);
  }
  const token = admin.data.access_token;

  const creado = await post(
    "/rpc/crear_medico_admin",
    {
      p_nombre: "Dr. Prueba Admin",
      p_especialidad: "Medicina General",
      p_telefono: "555-9999",
      p_email: EMAIL,
      p_dias: ["Sabado"],
      p_hora_inicio: "07:00:00",
      p_hora_fin: "12:00:00",
      p_duracion: 30,
      p_contrasena: CLAVE1,
    },
    token
  );
  check("medico creado", !!(creado.medico_id && creado.email === EMAIL), `id=${creado.medico_id}`);

  const docLogin1 = await login(EMAIL, CLAVE1);
  check("doctor puede iniciar sesión (clave inicial)", docLogin1.ok);

  const perfil = await get(
    `/perfiles?select=user_id,nombre,rol,medico_id&medico_id=eq.${creado.medico_id}`,
    token
  );
  check(
    "perfil del doctor correcto",
    perfil.length === 1 && perfil[0].rol === "medico" && perfil[0].medico_id === creado.medico_id
  );

  const actualizado = await post(
    "/rpc/actualizar_medico_admin",
    {
      p_id: creado.medico_id,
      p_nombre: "Dr. Prueba Admin Editado",
      p_especialidad: "Medicina General",
      p_telefono: "555-1111",
      p_email: EMAIL,
      p_dias: ["Sabado"],
      p_hora_inicio: "07:00:00",
      p_hora_fin: "13:00:00",
      p_duracion: 45,
      p_contrasena: CLAVE2,
    },
    token
  );
  check("medico editado", actualizado.ok === true);

  const docLogin2 = await login(EMAIL, CLAVE1);
  const docLogin3 = await login(EMAIL, CLAVE2);
  check("clave anterior ya no funciona", !docLogin2.ok);
  check("clave nueva funciona", docLogin3.ok);

  const fecha = nextSabado();
  const cita = await post(
    "/rpc/crear_cita",
    {
      p_paciente: PACIENTE,
      p_medico: creado.medico_id,
      p_fecha: fecha,
      p_hora: "07:00:00",
      p_motivo: "Cita prueba recordatorio",
      p_lugar: "consultorio",
    },
    token
  );
  check("cita creada para el doctor de prueba", !!cita.id);

  await managementQuery(`delete from public.recordatorios where cita_id = '${cita.id}';`);

  const generados = await post(
    `/rpc/generar_recordatorios_cita`,
    { p_cita_id: cita.id },
    token
  );
  check("recordatorios generados manualmente", generados === 2, `generados=${generados}`);

  const generados2 = await post(
    `/rpc/generar_recordatorios_cita`,
    { p_cita_id: cita.id },
    token
  );
  check("generación idempotente (no duplica)", generados2 === 0, `generados2=${generados2}`);

  const recs = await get(`/recordatorios?select=canal,estado&cita_id=eq.${cita.id}`, token);
  check(
    "existen recordatorios app y email",
    recs.length === 2 && recs.some((r) => r.canal === "app") && recs.some((r) => r.canal === "email")
  );

  await del(`/citas?id=eq.${cita.id}`, token);

  const sinPermiso = await post(
    "/rpc/eliminar_medico_admin",
    { p_id: creado.medico_id },
    admin.data.access_token
  );
  check("medico eliminado", sinPermiso.ok === true);

  const loginEliminado = await login(EMAIL, CLAVE2);
  check("login del doctor ya no funciona tras eliminar", !loginEliminado.ok);

  console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: TODO OK");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
