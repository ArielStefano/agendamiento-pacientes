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

const SUFIJO = new Date().getTime().toString(36);
const EMAIL_PACIENTE = `prueba.pac.${SUFIJO}@test.com`;
const EMAIL_REPRESENTANTE = `prueba.rep.${SUFIJO}@test.com`;
const NOMBRE_PACIENTE = "Niño Paciente Prueba";
const NOMBRE_REPRESENTANTE = "Mamá Representante Prueba";
const CLAVE = "PacienteTest123";

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

// Llamada ANÓNIMA (sin Authorization): simula la página pública de registro
async function registrar(body) {
  const res = await fetch(`${REST}/rpc/registrar_paciente`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function get(path, token) {
  const res = await fetch(`${REST}${path}`, {
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
}

async function post(path, body, token) {
  const res = await fetch(`${REST}${path}`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(data)}`);
  return data;
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

function basePayload(email, nombrePaciente, contrasena) {
  return {
    p_nombre_paciente: nombrePaciente,
    p_es_representante: false,
    p_nombre_cuenta: null,
    p_documento: null,
    p_email: email,
    p_telefono: "555-0000",
    p_fecha_nacimiento: "2015-06-10",
    p_direccion: "Calle de Prueba 123",
    p_alergias: "Ninguna",
    p_contrasena: contrasena,
  };
}

async function main() {
  // ===== Caso 1: el paciente crea su propia cuenta =====
  const r1 = await registrar(basePayload(EMAIL_PACIENTE, NOMBRE_PACIENTE, CLAVE));
  check("paciente se registra solo (anon)", r1.ok && r1.data.ok === true, r1.status);

  const sesion1 = await login(EMAIL_PACIENTE, CLAVE);
  check("paciente inicia sesión", sesion1.ok);
  const uid1 = sesion1.data.user.id;
  const perfil1 = await get(`/perfiles?select=nombre,rol,representante,paciente_id&user_id=eq.${uid1}`, sesion1.data.access_token);
  check(
    "perfil: nombre = paciente, no representante",
    perfil1.length === 1 && perfil1[0].nombre === NOMBRE_PACIENTE && perfil1[0].rol === "paciente" && perfil1[0].representante === false,
    `nombre=${perfil1[0]?.nombre} rep=${perfil1[0]?.representante}`
  );
  const ficha1 = await get(`/pacientes?select=nombre&id=eq.${perfil1[0].paciente_id}`, sesion1.data.access_token);
  check("ficha paciente: nombre correcto", ficha1.length === 1 && ficha1[0].nombre === NOMBRE_PACIENTE);

  // ===== Caso 2: un representante crea la cuenta =====
  const r2 = await registrar({
    ...basePayload(EMAIL_REPRESENTANTE, NOMBRE_PACIENTE, CLAVE),
    p_es_representante: true,
    p_nombre_cuenta: NOMBRE_REPRESENTANTE,
  });
  check("representante se registra", r2.ok && r2.data.ok === true, r2.status);

  const sesion2 = await login(EMAIL_REPRESENTANTE, CLAVE);
  check("representante inicia sesión", sesion2.ok);
  const uid2 = sesion2.data.user.id;
  const perfil2 = await get(`/perfiles?select=nombre,rol,representante,paciente_id&user_id=eq.${uid2}`, sesion2.data.access_token);
  check(
    "perfil: nombre = representante, representante=true",
    perfil2.length === 1 && perfil2[0].nombre === NOMBRE_REPRESENTANTE && perfil2[0].representante === true,
    `nombre=${perfil2[0]?.nombre} rep=${perfil2[0]?.representante}`
  );
  const ficha2 = await get(`/pacientes?select=nombre&id=eq.${perfil2[0].paciente_id}`, sesion2.data.access_token);
  check("ficha paciente (vía representante): nombre del paciente", ficha2.length === 1 && ficha2[0].nombre === NOMBRE_PACIENTE);

  // ===== Caso 3: representante sin nombre -> rechazado =====
  const r3 = await registrar({
    ...basePayload(`sin.nombre.${SUFIJO}@test.com`, NOMBRE_PACIENTE, CLAVE),
    p_es_representante: true,
    p_nombre_cuenta: "",
  });
  check("representante sin nombre rechazado", !r3.ok);

  // ===== Caso 4: no se escalan privilegios =====
  const admins = await managementQuery("select count(*) as n from public.perfiles where rol = 'admin';");
  check("no se crearon admins extra", Number(admins[0].n) === 1, `admins=${admins[0].n}`);

  // Limpieza
  await managementQuery(`delete from auth.users where email in ('${EMAIL_PACIENTE}', '${EMAIL_REPRESENTANTE}');`);
  await managementQuery(`delete from public.pacientes where email in ('${EMAIL_PACIENTE}', '${EMAIL_REPRESENTANTE}');`);

  const loginPost = await login(EMAIL_PACIENTE, CLAVE);
  check("usuarios eliminados tras la prueba", !loginPost.ok);

  console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: TODO OK");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
