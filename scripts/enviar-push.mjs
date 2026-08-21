#!/usr/bin/env node
"use strict";

/**
 * enviar-push.mjs
 * Envía notificaciones push a usuarios suscritos.
 *
 * Uso:
 *   node scripts/enviar-push.mjs --titulo "Recordatorio" --mensaje "Su cita es mañana" --url "./calendario.html"
 *   node scripts/enviar-push.mjs --titulo "Recordatorio" --mensaje "Su cita es mañana" --user-id <uuid>
 *   node scripts/enviar-push.mjs --titulo "Recordatorio" --mensaje "Su cita es mañana" --todos
 *   node scripts/enviar-push.mjs --cola   (procesa la cola push_cola)
 *
 * Requiere .env con VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY y SUPABASE_*.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Cargar .env ──────────────────────────────────────────────
function loadEnv() {
  const envPath = resolve(__dirname, "..", ".env");
  try {
    const lines = readFileSync(envPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (e) {
    console.error("No se pudo leer .env:", e.message);
  }
}
loadEnv();

// ── Dependencias ─────────────────────────────────────────────
let webPush, createClient;
try {
  webPush = (await import("web-push")).default;
} catch {
  console.error("Falta web-push. Instale con: npm install web-push");
  process.exit(1);
}
try {
  createClient = (await import("@supabase/supabase-js")).createClient;
} catch {
  console.error("Falta @supabase/supabase-js");
  process.exit(1);
}

// ── Config ───────────────────────────────────────────────────
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!VAPID_PRIVATE_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Faltan variables de entorno requeridas (VAPID_PRIVATE_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)");
  process.exit(1);
}

webPush.setVapidDetails("mailto:admin@clinica.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Argumentos ───────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { titulo: "CliniAgenda", mensaje: "", url: "./dashboard.html", userId: null, todos: false, cola: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--titulo" && args[i + 1]) opts.titulo = args[++i];
    if (args[i] === "--mensaje" && args[i + 1]) opts.mensaje = args[++i];
    if (args[i] === "--url" && args[i + 1]) opts.url = args[++i];
    if (args[i] === "--user-id" && args[i + 1]) opts.userId = args[++i];
    if (args[i] === "--todos") opts.todos = true;
    if (args[i] === "--cola") opts.cola = true;
  }
  return opts;
}

// ── Main ─────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs();

  // Modo cola: procesar pendientes en push_cola
  if (opts.cola) {
    await procesarCola();
    return;
  }

  if (!opts.mensaje) {
    console.error("Falta --mensaje (o use --cola para procesar la cola)");
    process.exit(1);
  }

  // Obtener suscripciones
  let query = supabase.from("push_suscripciones").select("id, user_id, endpoint, p256dh, auth");
  if (opts.userId) {
    query = query.eq("user_id", opts.userId);
  } else if (!opts.todos) {
    // Por defecto enviar a admin, recepcion, medicos (no pacientes)
    query = query.in("user_id", await getUserIdsWithRoles(["admin", "recepcion", "medico"]));
  }

  const { data: subs, error } = await query;
  if (error) {
    console.error("Error consultando suscripciones:", error.message);
    process.exit(1);
  }

  if (!subs || !subs.length) {
    console.log("No hay suscripciones push para enviar.");
    process.exit(0);
  }

  console.log(`Enviando push a ${subs.length} suscriptor(es)...`);

  let enviados = 0, fallidos = 0, eliminados = 0;

  for (const sub of subs) {
    const payload = JSON.stringify({
      title: opts.titulo,
      body: opts.mensaje,
      url: opts.url,
      tag: "cliniagenda-recordatorio",
    });

    try {
      await webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload
      );
      enviados++;
    } catch (err) {
      fallidos++;
      // 404 / 410 = subscription expired → delete
      if (err.statusCode === 404 || err.statusCode === 410) {
        await supabase.from("push_suscripciones").delete().eq("id", sub.id);
        eliminados++;
      }
      console.error(`  Falló sub ${sub.id.slice(0, 8)}: ${err.statusCode || err.message}`);
    }
  }

  console.log(`\nResultado: ${enviados} enviados, ${fallidos} fallidos, ${eliminados} suscripciones obsoletas eliminadas.`);
}

async function getUserIdsWithRoles(roles) {
  const { data } = await supabase.from("perfiles").select("user_id").in("rol", roles);
  return (data || []).map((r) => r.user_id);
}

async function procesarCola() {
  const { data: jobs, error } = await supabase
    .from("push_cola")
    .select("id, user_id, titulo, mensaje, url")
    .eq("estado", "pendiente")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    console.error("Error leyendo cola:", error.message);
    process.exit(1);
  }
  if (!jobs || !jobs.length) {
    console.log("Cola vacía, nothing to do.");
    return;
  }

  console.log(`Procesando ${jobs.length} job(s) de la cola...`);

  for (const job of jobs) {
    // Obtener suscripciones del usuario (o todas si user_id es null)
    let subQuery = supabase.from("push_suscripciones").select("id, endpoint, p256dh, auth");
    if (job.user_id) {
      subQuery = subQuery.eq("user_id", job.user_id);
    }
    const { data: subs } = await subQuery;
    if (!subs || !subs.length) {
      console.log(`  Job ${job.id.slice(0, 8)}: sin suscripciones, marcado como enviado.`);
      await supabase.from("push_cola").update({ estado: "enviado", enviado_at: new Date().toISOString() }).eq("id", job.id);
      continue;
    }

    let enviados = 0;
    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify({ title: job.titulo, body: job.mensaje, url: job.url || "./dashboard.html", tag: "cliniagenda-recordatorio" })
        );
        enviados++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from("push_suscripciones").delete().eq("id", sub.id);
        }
      }
    }
    await supabase.from("push_cola").update({ estado: "enviado", enviado_at: new Date().toISOString() }).eq("id", job.id);
    console.log(`  Job ${job.id.slice(0, 8)}: ${enviados}/${subs.length} enviados`);
  }

  console.log("Cola procesada.");
}

main().catch((e) => {
  console.error("Error fatal:", e);
  process.exit(1);
});
