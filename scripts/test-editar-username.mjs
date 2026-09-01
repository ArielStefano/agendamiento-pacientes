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
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const URL = process.env.SUPABASE_URL;
const REST = `${URL}/rest/v1`;

async function rpc(name, body, token) {
  const h = { apikey: KEY, "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const r = await fetch(`${REST}/rpc/${name}`, { method: "POST", headers: h, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, data: await r.json() };
}
async function login(id, pw) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: id, password: pw }) });
  return { ok: r.ok, data: await r.json() };
}

let failures = 0;
function check(n, ok, x = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${n}${x ? " — " + x : ""}`); if (!ok) failures++; }

const admin = await login("admin@clinica.com", "admin123");
const token = admin.data.access_token;

// Usar el médico de prueba creado (Dr. Username Test) - buscar el más reciente por su username
const u = Math.random().toString(36).slice(2, 8);
const nuevo = await rpc("crear_medico_admin", {
  p_nombre: "Dr. Editar Test", p_especialidad: "Dermatología", p_telefono: null,
  p_email: null, p_dias: ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes"],
  p_hora_inicio: "08:00", p_hora_fin: "13:00", p_duracion: 30,
  p_contrasena: "Test1234", p_username: `edit.${u}`,
}, token);
check("crear médico para editar", nuevo.ok, JSON.stringify(nuevo.data));
const medicoId = nuevo.data?.medico_id;

// Editar: cambiar username de edit.xxx a nuevo.xxx
const nuevoUsername = `nuevo.${u}`;
const edit = await rpc("actualizar_medico_admin", {
  p_id: medicoId,
  p_nombre: "Dr. Editar Test 2",
  p_especialidad: "Cardiología",
  p_telefono: null,
  p_email: null,
  p_dias: ["Lunes", "Martes", "Miercoles"],
  p_hora_inicio: "09:00", p_hora_fin: "12:00",
  p_duracion: 30,
  p_contrasena: "",
  p_username: nuevoUsername,
  p_hora_inicio_sabado: null, p_hora_fin_sabado: null,
  p_buffer_domicilio_min: 30,
  p_hora_inicio_descanso: null, p_hora_fin_descanso: null,
  p_hora_inicio_descanso_sabado: null, p_hora_fin_descanso_sabado: null,
  p_lugares_atencion: ["Consultorio"],
}, token);
check("editar médico (cambiar username)", edit.ok, `${edit.status} ${JSON.stringify(edit.data)}`);
const emailEditado = edit.data?.email;
check("email editado = nuevo username@clinica.local", edit.ok && emailEditado === `${nuevoUsername}@clinica.local`, emailEditado);

// El nuevo username resuelve al nuevo email
const res = await rpc("resolver_email_por_usuario", { p_input: nuevoUsername });
check(`resolver('${nuevoUsername}') = nuevo email`, res.ok && res.data === `${nuevoUsername}@clinica.local`, JSON.stringify(res.data));

// Login con el nuevo email (misma contraseña, no cambió)
if (emailEditado) {
  const lm = await login(emailEditado, "Test1234");
  check("login tras editar username", lm.ok, JSON.stringify(lm.data));
}

// El username anterior ya no resuelve
const resOld = await rpc("resolver_email_por_usuario", { p_input: `edit.${u}` });
check(`resolver('edit.${u}') = null tras renombrar`, resOld.ok && resOld.data == null, JSON.stringify(resOld.data));

// === Caso crítico: médico con email real + username backfilleado:
// 1) crear con username genera email @clinica.local
// 2) "promover a email real": se usa actualizar con p_email real
// 3) editar SIN cambiar username no debe volver a @clinica.local ni borrar el email real
const prom = await rpc("actualizar_medico_admin", {
  p_id: medicoId, p_nombre: "Dr. Editar Test 3", p_especialidad: "Cardiología", p_telefono: null,
  p_email: `real.${u}@gmail.com`, p_dias: ["Lunes", "Martes", "Miercoles"],
  p_hora_inicio: "09:00", p_hora_fin: "12:00", p_duracion: 30, p_contrasena: "",
  p_username: nuevoUsername,
  p_hora_inicio_sabado: null, p_hora_fin_sabado: null, p_buffer_domicilio_min: 30,
  p_hora_inicio_descanso: null, p_hora_fin_descanso: null,
  p_hora_inicio_descanso_sabado: null, p_hora_fin_descanso_sabado: null,
  p_lugares_atencion: ["Consultorio"],
}, token);
check("promover a email real (mismo username)", prom.ok && prom.data?.email === `real.${u}@gmail.com`, JSON.stringify(prom.data));

// 3) edición normal SIN tocar username: campo se precarga con username (sin @), p_email null
const reeditar = await rpc("actualizar_medico_admin", {
  p_id: medicoId, p_nombre: "Dr. Editar Test 3", p_especialidad: "Dermatología", p_telefono: null,
  p_email: null, p_dias: ["Lunes", "Martes", "Miercoles"],
  p_hora_inicio: "09:00", p_hora_fin: "12:00", p_duracion: 30, p_contrasena: "",
  p_username: nuevoUsername,
  p_hora_inicio_sabado: null, p_hora_fin_sabado: null, p_buffer_domicilio_min: 30,
  p_hora_inicio_descanso: null, p_hora_fin_descanso: null,
  p_hora_inicio_descanso_sabado: null, p_hora_fin_descanso_sabado: null,
  p_lugares_atencion: ["Consultorio"],
}, token);
check("reeditar sin cambio: conserva email real", reeditar.ok && reeditar.data?.email === `real.${u}@gmail.com`, JSON.stringify(reeditar.data));

// 4) resolver sigue apuntando al email real y login funciona con él
const resReal = await rpc("resolver_email_por_usuario", { p_input: nuevoUsername });
check(`resolver tras email real = ${`real.${u}@gmail.com`}`, resReal.ok && resReal.data === `real.${u}@gmail.com`, JSON.stringify(resReal.data));
const lReal = await login(`real.${u}@gmail.com`, "Test1234");
check("login con email real", lReal.ok, JSON.stringify(lReal.data));

// 5) cambiar username AHORA: como el email ya es real, NO debe regenerar @clinica.local
const renombrar2 = await rpc("actualizar_medico_admin", {
  p_id: medicoId, p_nombre: "Dr. Editar Test 3", p_especialidad: "Dermatología", p_telefono: null,
  p_email: null, p_dias: ["Lunes", "Martes", "Miercoles"],
  p_hora_inicio: "09:00", p_hora_fin: "12:00", p_duracion: 30, p_contrasena: "",
  p_username: `renombrado.${u}`,
  p_hora_inicio_sabado: null, p_hora_fin_sabado: null, p_buffer_domicilio_min: 30,
  p_hora_inicio_descanso: null, p_hora_fin_descanso: null,
  p_hora_inicio_descanso_sabado: null, p_hora_fin_descanso_sabado: null,
  p_lugares_atencion: ["Consultorio"],
}, token);
check("renombrar con email real: conserva email real", renombrar2.ok && renombrar2.data?.email === `real.${u}@gmail.com`, JSON.stringify(renombrar2.data));

console.log(failures ? `\n${failures} fallos` : "\nTodo OK");
process.exit(failures ? 1 : 0);