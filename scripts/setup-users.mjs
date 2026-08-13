// ============================================================
//  Crear usuarios de demostración en Supabase Auth
//
//  Uso:
//    1) Copie .env.example a .env y complete:
//         SUPABASE_URL = https://TU-PROYECTO.supabase.co
//         SUPABASE_SERVICE_ROLE_KEY = <Service Role Key>
//    2) Ejecute:
//         node scripts/setup-users.mjs
//
//  IMPORTANTE: la clave service_role tiene acceso total.
//  Ejecute este script SOLO en su máquina y no lo suba al repositorio.
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

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (revise .env)");
  process.exit(1);
}

const USUARIOS = [
  { email: "admin@clinica.com", password: "admin123", perfil: { nombre: "Administrador", rol: "admin" } },
  { email: "recepcion@clinica.com", password: "recepcion123", perfil: { nombre: "María Gómez", rol: "recepcion" } },
  { email: "ana@clinica.com", password: "medico123", perfil: { nombre: "Dra. Ana López", rol: "medico", medico_email: "ana@clinica.com" } },
  { email: "carlos@clinica.com", password: "medico123", perfil: { nombre: "Dr. Carlos Mendoza", rol: "medico", medico_email: "carlos@clinica.com" } },
  { email: "lucia@clinica.com", password: "medico123", perfil: { nombre: "Dra. Lucía Fernández", rol: "medico", medico_email: "lucia@clinica.com" } },
];

async function adminApi(path, options = {}) {
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

async function main() {
  console.log("Conectando a:", SUPABASE_URL);

  const medicos = await adminApi("/rest/v1/medicos?select=id,email");
  const medicoPorEmail = Object.fromEntries(medicos.map((m) => [m.email, m.id]));

  for (const u of USUARIOS) {
    console.log(`Creando usuario ${u.email} ...`);
    try {
      const created = await adminApi("/auth/v1/admin/users", {
        method: "POST",
        body: JSON.stringify({ email: u.email, password: u.password, email_confirm: true }),
      });

      const perfil = {
        user_id: created.id,
        nombre: u.perfil.nombre,
        rol: u.perfil.rol,
        medico_id: u.perfil.medico_email ? medicoPorEmail[u.perfil.medico_email] || null : null,
      };

      await adminApi("/rest/v1/perfiles", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(perfil),
      });
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
