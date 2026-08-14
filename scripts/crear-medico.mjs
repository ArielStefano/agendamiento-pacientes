// ============================================================
//  Crear un médico nuevo: registro en medicos + usuario Auth + perfil
//
//  Uso:
//    node scripts/crear-medico.mjs "Nombre Completo" correo@clinica.com \
//         [contrasena] ["Especialidad"] ["Lunes,Miercoles"] 07:00:00 12:00:00
//
//  - Si omite la contraseña, se genera una aleatoria y se muestra.
//  - Los días deben usar los nombres del sistema:
//    Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo (sin acentos).
//  - Requiere .env con SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_PAT.
// ============================================================

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

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

const [nombre, email, passwordArg, especialidadArg, diasArg, inicioArg, finArg] = process.argv.slice(2);

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PAT = process.env.SUPABASE_PAT;

if (!SUPABASE_URL || !SERVICE_KEY || !PAT) {
  console.error("Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_PAT (revise .env)");
  process.exit(1);
}
if (!nombre || !email) {
  console.error("Uso: node scripts/crear-medico.mjs \"Nombre\" correo@clinica.com [clave] [especialidad] [dias] inicio fin");
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0];
const password = passwordArg || randomBytes(9).toString("base64url");
const especialidad = especialidadArg || "Psicología";
const dias = (diasArg || "Sabado")
  .split(",")
  .map((d) => d.trim())
  .filter(Boolean);
const horaInicio = inicioArg || "07:00:00";
const horaFin = finArg || "12:00:00";

function escSql(s) {
  return String(s ?? "").replace(/'/g, "''");
}

async function authAdminApi(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function managementQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`SQL -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  console.log(`Creando médico "${nombre}" (${especialidad}) ...`);

  const diasJson = JSON.stringify(dias);
  const filas = await managementQuery(
    `insert into public.medicos (nombre, especialidad, email, dias_atencion, hora_inicio, hora_fin, duracion_cita_min) ` +
      `values ('${escSql(nombre)}', '${escSql(especialidad)}', '${escSql(email)}', ` +
      `'${escSql(diasJson)}'::jsonb, '${horaInicio}', '${horaFin}', 30) returning id, nombre;`
  );
  const medico = filas[0];

  const usuario = await authAdminApi("/auth/v1/admin/users", {
    method: "POST",
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  await managementQuery(
    `insert into public.perfiles (user_id, nombre, rol, medico_id) ` +
      `values ('${usuario.id}', '${escSql(nombre)}', 'medico', '${medico.id}');`
  );

  console.log("Listo. Acceso de la psicóloga:");
  console.log(`  URL:      ${SUPABASE_URL.replace("https://", "https://").split(".")[0]}`);
  console.log(`  Usuario:  ${email}`);
  console.log(`  Clave:    ${password}`);
  console.log(`  Horario:  ${dias.join(", ")} ${horaInicio} - ${horaFin}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
