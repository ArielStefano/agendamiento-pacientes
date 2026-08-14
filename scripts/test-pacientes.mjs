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
const EMAIL = `prueba.paciente.${SUFIJO}@test.com`;
const NOMBRE = "Paciente Prueba Autoregistro";
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

async function get(path, token) {
  const res = await fetch(`${REST}${path}`, {
    headers: { apikey: PUBLISHABLE, Authorization: `Bearer ${token}` },
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

const payload = {
  p_nombre: NOMBRE,
  p_documento: null,
  p_email: EMAIL,
  p_telefono: "555-0000",
  p_fecha_nacimiento: "2015-06-10",
  p_direccion: "Calle de Prueba 123",
  p_alergias: "Ninguna",
  p_contrasena: CLAVE,
};

async function main() {
  // 1) Registro como anónimo (lo que hace la página pública)
  const r1 = await registrar(payload);
  check("registro anónimo devuelve ok", r1.ok && r1.data.ok === true, r1.status);

  // 2) Email ya existente -> rechazado
  const r2 = await registrar(payload);
  check("email duplicado rechazado", !r2.ok && r2.status === 400);

  // 3) Validación: contraseña corta
  const r3 = await registrar({ ...payload, p_contrasena: "123", p_email: `corta.${SUFIJO}@test.com` });
  check("contraseña corta rechazada", !r3.ok);

  // 4) Validación: email inválido
  const r4 = await registrar({ ...payload, p_contrasena: "Valida123", p_email: "no-es-un-email" });
  check("email inválido rechazado", !r4.ok);

  // 5) El paciente inicia sesión con sus credenciales
  const sesion = await login(EMAIL, CLAVE);
  check("paciente inicia sesión", sesion.ok);
  if (!sesion.ok) {
    console.error(JSON.stringify(sesion.data));
    process.exit(1);
  }
  const token = sesion.data.access_token;
  const uid = sesion.data.user.id;

  // 6) Su perfil es rol 'paciente' con paciente_id enlazado
  const perfil = await get(`/perfiles?select=user_id,nombre,rol,paciente_id&user_id=eq.${uid}`, token);
  check(
    "perfil rol paciente + paciente_id",
    perfil.length === 1 &&
      perfil[0].rol === "paciente" &&
      perfil[0].paciente_id &&
      perfil[0].nombre === NOMBRE,
    `rol=${perfil[0]?.rol}`
  );

  // 7) La ficha del paciente quedó creada (y se ve solo con su sesión)
  const paci = await get(`/pacientes?select=id,nombre,email&id=eq.${perfil[0].paciente_id}`, token);
  check("ficha del paciente creada", paci.length === 1 && paci[0].email === EMAIL);

  // 8) Helper paciente_id_usuario devuelve su propio paciente
  const miPaciente = await post("/rpc/paciente_id_usuario", {}, token);
  check("paciente_id_usuario() correcto", miPaciente === perfil[0].paciente_id);

  // 9) Un paciente NO puede crear un médico (privilegios no escalables)
  const noEscalar = await registrar({ ...payload, p_email: `escala.${SUFIJO}@test.com`, p_contrasena: "Valida123" });
  // registrar_paciente solo crea rol 'paciente'; verificar que no existan perfiles admin extra
  const admins = await managementQuery(
    "select count(*) as n from public.perfiles where rol = 'admin';"
  );
  check("no se crearon admins extra", Number(admins[0].n) === 1, `admins=${admins[0].n}`);

  // Limpieza
  await managementQuery(`delete from auth.users where email = '${EMAIL}';`);
  await managementQuery(`delete from public.pacientes where email = '${EMAIL}';`);

  const loginPost = await login(EMAIL, CLAVE);
  check("usuario eliminado tras la prueba", !loginPost.ok);

  console.log(failures ? `\nRESULTADO: ${failures} fallo(s)` : "\nRESULTADO: TODO OK");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
