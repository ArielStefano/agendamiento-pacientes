// ============================================================
//  Crear usuarios de demostración en Supabase Auth + perfiles
//
//  Uso:
//    1) Copie .env.example a .env y complete:
//         SUPABASE_URL
//         SUPABASE_SERVICE_ROLE_KEY   (secret key)
//         SUPABASE_PUBLISHABLE_KEY    (publishable key, opcional)
//         SUPABASE_PAT                (token personal para Management API)
//    2) Ejecute:
//         node scripts/setup-users.mjs
//
//  IMPORTANTE: las claves secret/pat tienen acceso total.
//  Ejecute este script SOLO en su máquina; el .env NO se sube al repositorio.
// ============================================================

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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const PAT = process.env.SUPABASE_PAT;

if (!SUPABASE_URL || !SERVICE_KEY || !PAT) {
  console.error("Faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o SUPABASE_PAT (revise .env)");
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.replace(/^https:\/\//, "").split(".")[0];

const USUARIOS = [
  { email: "admin@clinica.com", password: "admin123", perfil: { nombre: "Administrador", rol: "admin" } },
  { email: "recepcion@clinica.com", password: "recepcion123", perfil: { nombre: "María Gómez", rol: "recepcion" } },
  { email: "ana@clinica.com", password: "medico123", perfil: { nombre: "Dra. Ana López", rol: "medico", medico_email: "ana@clinica.com" } },
  { email: "carlos@clinica.com", password: "medico123", perfil: { nombre: "Dr. Carlos Mendoza", rol: "medico", medico_email: "carlos@clinica.com" } },
  { email: "lucia@clinica.com", password: "medico123", perfil: { nombre: "Dra. Lucía Fernández", rol: "medico", medico_email: "lucia@clinica.com" } },
];

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
  if (!res.ok) {
    throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function managementQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PAT}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`SQL -> ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function main() {
  console.log("Conectando a:", SUPABASE_URL);

  const medicos = await managementQuery("select id, email from medicos;");
  const medicoPorEmail = Object.fromEntries(medicos.map((m) => [m.email, m.id]));

  for (const u of USUARIOS) {
    console.log(`Creando usuario ${u.email} ...`);
    try {
      const created = await authAdminApi("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
      });

      const medico_id = u.perfil.medico_email ? medicoPorEmail[u.perfil.medico_email] || null : null;
      const medicoIdSql = medico_id ? `'${medico_id}'` : "null";

      const sql =
        `insert into public.perfiles (user_id, nombre, rol, medico_id) ` +
        `values ('${created.id}', '${escSql(u.perfil.nombre)}', '${u.perfil.rol}', ${medicoIdSql});`;

      await managementQuery(sql);
      console.log(`  -> OK (${created.id})`);
    } catch (err) {
      console.error(`  -> Error: ${err.message}`);
    }
  }

  console.log("\nListo. Accesos:");
  for (const u of USUARIOS) {
    console.log(`  ${u.email} / ${u.password}  (${u.perfil.rol})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
