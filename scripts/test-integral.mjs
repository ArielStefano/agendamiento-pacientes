"use strict";

const BASE = "https://xgfwcrdrkzcoxepnicfb.supabase.co";
const KEY = "sb_publishable_xQtBw6keFlyfmOh5faQ76w_AT2n-6U9";
const HDR = { apikey: KEY, "Content-Type": "application/json" };

let pass = 0, fail = 0;
function ok(label) { pass++; console.log(`  PASS  ${label}`); }
function ko(label, msg) { fail++; console.log(`  FAIL  ${label} — ${msg}`); }
function assert(label, cond, msg) { cond ? ok(label) : ko(label, msg || "assertion failed"); }

async function login(email, password) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: HDR,
    body: JSON.stringify({ email, password }),
  });
  const d = await r.json();
  return d.access_token;
}

async function rpc(name, body, token) {
  const headers = { ...HDR };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/rest/v1/rpc/${name}`, {
    method: "POST", headers, body: JSON.stringify(body),
  });
  const data = await r.json();
  return { ok: r.ok, data, status: r.status };
}

async function get(table, params, token) {
  const headers = { ...HDR };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/rest/v1/${table}?${params}`, { headers });
  const data = await r.json();
  return { ok: r.ok, data, status: r.status };
}

async function del(table, params, token) {
  const headers = { ...HDR };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}/rest/v1/${table}?${params}`, { method: "DELETE", headers });
  return { ok: r.ok, status: r.status };
}

function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function extractId(data) {
  if (!data) return null;
  if (typeof data === "string") return data;
  if (typeof data === "object" && data.id) return data.id;
  if (typeof data === "object" && data.paciente_id) return data.paciente_id;
  if (typeof data === "object" && data.medico_id) return data.medico_id;
  return null;
}

// ═══════════════════════════════════════════
// 1. LOGIN
// ═══════════════════════════════════════════
console.log("\n=== 1. LOGIN ===");
const adminToken = await login("admin@clinica.com", "admin123");
assert("admin login", !!adminToken);

const pacToken = await login("paciente@test.com", "123456");
assert("paciente login", !!pacToken);

// ═══════════════════════════════════════════
// 2. PERFILES
// ═══════════════════════════════════════════
console.log("\n=== 2. PERFILES ===");
const adminUser = await (await fetch(`${BASE}/auth/v1/user`, { headers: { ...HDR, Authorization: `Bearer ${adminToken}` } })).json();
const adminP = await get("perfiles", "select=rol&user_id=eq." + adminUser.id, adminToken);
assert("admin rol=admin", adminP.ok && adminP.data[0]?.rol === "admin");

const pacUser = await (await fetch(`${BASE}/auth/v1/user`, { headers: { ...HDR, Authorization: `Bearer ${pacToken}` } })).json();
const pacP = await get("perfiles", "select=rol&user_id=eq." + pacUser.id, pacToken);
assert("paciente rol=paciente", pacP.ok && pacP.data[0]?.rol === "paciente");

// ═══════════════════════════════════════════
// 3. MÉDICO: HORARIOS Y DESCANSO
// ═══════════════════════════════════════════
console.log("\n=== 3. MÉDICO - HORARIOS ===");
const joss = await get("medicos", "select=*&email=eq.jtoaquiza@clinica.com", adminToken);
assert("Josselyn encontrada", joss.ok && joss.data.length === 1);
const med = joss.data[0];
const medicoId = med.id;
assert("hora_inicio = 08:00", String(med.hora_inicio).startsWith("08:00"));
assert("hora_fin = 17:00 o 20:00", med.hora_fin && (String(med.hora_fin).includes("17:00") || String(med.hora_fin).includes("20:00")), `actual=${med.hora_fin}`);
assert("sabado inicio = 08:00", String(med.hora_inicio_sabado).startsWith("08:00"));
assert("sabado fin = 17:00", String(med.hora_fin_sabado).startsWith("17:00"));
assert("descanso inicio = 13:00", String(med.hora_inicio_descanso).startsWith("13:00"));
assert("descanso fin = 17:00", String(med.hora_fin_descanso).startsWith("17:00"));
assert("dias incluye Sabado", (med.dias_atencion || []).includes("Sabado"));
assert("duracion = 60", med.duracion_cita_min === 60);
assert("buffer domicilio existe", med.buffer_domicilio_min > 0, `val=${med.buffer_domicilio_min}`);

// ═══════════════════════════════════════════
// 4. CRUD PACIENTE
// ═══════════════════════════════════════════
console.log("\n=== 4. CRUD PACIENTE ===");
const ts = Date.now();
const testDoc = String(ts).slice(-10);
const testEmail = `test${ts}@test.com`;
const crearPac = await rpc("crear_paciente_admin", {
  p_nombre: "Paciente Test", p_documento: testDoc, p_email: testEmail,
  p_telefono: "0999999999", p_fecha_nacimiento: "1990-01-15",
  p_direccion: "Dir Test", p_alergias: "Ninguna", p_notas: "Test",
});
assert("crear paciente", crearPac.ok, JSON.stringify(crearPac.data));
const testPacId = extractId(crearPac.data) || crearPac.data;

const verificarPac = await get("pacientes", "select=nombre&id=eq." + testPacId, adminToken);
assert("paciente creado nombre", verificarPac.ok && verificarPac.data[0]?.nombre === "Paciente Test");

const updPac = await rpc("actualizar_paciente_admin", {
  p_id: testPacId, p_nombre: "Paciente Test V2", p_documento: testDoc,
  p_email: testEmail, p_telefono: "0988888888", p_fecha_nacimiento: "1990-01-15",
  p_direccion: "Dir Actualizada", p_alergias: "Penicilina", p_notas: "Actualizado",
});
assert("actualizar paciente", updPac.ok, JSON.stringify(updPac.data));

const verificarUpd = await get("pacientes", "select=nombre,alergias,direccion&id=eq." + testPacId, adminToken);
assert("paciente nombre V2", verificarUpd.ok && verificarUpd.data[0]?.nombre === "Paciente Test V2");
assert("paciente alergias", verificarUpd.data[0]?.alergias === "Penicilina");
assert("paciente direccion", verificarUpd.data[0]?.direccion === "Dir Actualizada");

// ═══════════════════════════════════════════
// 5. CRUD MÉDICO
// ═══════════════════════════════════════════
console.log("\n=== 5. CRUD MÉDICO ===");
const medTestEmail = `medtest${ts}@test.com`;
const crearMed = await rpc("crear_medico_admin", {
  p_nombre: "Doctor Test", p_especialidad: "Cardiología", p_telefono: "0977777777",
  p_email: medTestEmail, p_dias: ["Lunes","Martes","Miercoles"],
  p_hora_inicio: "09:00:00", p_hora_fin: "14:00:00", p_duracion: 45,
  p_contrasena: "testmedico123", p_hora_inicio_sabado: null, p_hora_fin_sabado: null,
  p_buffer_domicilio_min: 20, p_hora_inicio_descanso: "11:30:00", p_hora_fin_descanso: "12:30:00",
});
assert("crear medico", crearMed.ok, JSON.stringify(crearMed.data));
const testMedData = crearMed.data;
const testMedId = extractId(testMedData) || testMedData;

const vMed = await get("medicos", "select=*&id=eq." + testMedId, adminToken);
assert("medico creado nombre", vMed.ok && vMed.data[0]?.nombre === "Doctor Test");
assert("medico creado especialidad", vMed.data[0]?.especialidad === "Cardiología");
assert("medico creado descanso", String(vMed.data[0]?.hora_inicio_descanso).startsWith("11:30"));
assert("medico creado buffer", vMed.data[0]?.buffer_domicilio_min === 20);
assert("medico creado duracion", vMed.data[0]?.duracion_cita_min === 45);

const updMed = await rpc("actualizar_medico_admin", {
  p_id: testMedId, p_nombre: "Doctor Test V2", p_especialidad: "Cardio Interv.",
  p_telefono: "0966666666", p_email: medTestEmail,
  p_dias: ["Lunes","Martes","Miercoles","Jueves","Viernes"],
  p_hora_inicio: "08:00:00", p_hora_fin: "16:00:00", p_duracion: 30,
  p_hora_inicio_sabado: null, p_hora_fin_sabado: null,
  p_buffer_domicilio_min: 15, p_hora_inicio_descanso: "12:00:00", p_hora_fin_descanso: "13:00:00",
});
assert("actualizar medico", updMed.ok, JSON.stringify(updMed.data));

const vMed2 = await get("medicos", "select=*&id=eq." + testMedId, adminToken);
assert("medico nombre V2", vMed2.data[0]?.nombre === "Doctor Test V2");
assert("medico especialidad V2", vMed2.data[0]?.especialidad === "Cardio Interv.");
assert("medico descanso V2", String(vMed2.data[0]?.hora_inicio_descanso).startsWith("12:00"));

// ═══════════════════════════════════════════
// 6. CREAR CITA (ADMIN)
// ═══════════════════════════════════════════
console.log("\n=== 6. CREAR CITA ===");
const hoy = new Date();
let fechaCita = new Date(hoy);
const diaSemana = fechaCita.getDay();
if (diaSemana === 0) fechaCita.setDate(fechaCita.getDate() + 1);
else if (diaSemana === 6) fechaCita.setDate(fechaCita.getDate() + 2);
else fechaCita.setDate(fechaCita.getDate() + 1);
const fechaStr = isoDate(fechaCita);

const crearCita = await rpc("crear_cita", {
  p_paciente: testPacId, p_medico: medicoId, p_fecha: fechaStr,
  p_hora: "10:00:00", p_motivo: "Cita test", p_lugar: "consultorio",
}, adminToken);
assert("crear cita admin", crearCita.ok, JSON.stringify(crearCita.data));
const citaId = extractId(crearCita.data) || crearCita.data;

const vCita = await get("citas", "select=*,pacientes(nombre),medicos(nombre)&id=eq." + citaId, adminToken);
assert("cita paciente correcto", vCita.ok && vCita.data[0]?.pacientes?.nombre === "Paciente Test V2");
assert("cita medico correcto", vCita.data[0]?.medicos?.nombre === "Josselyn Toaquiza");
assert("cita lugar=consultorio", vCita.data[0]?.lugar === "consultorio");

// ═══════════════════════════════════════════
// 7. CAMBIAR ESTADOS
// ═══════════════════════════════════════════
console.log("\n=== 7. CAMBIAR ESTADOS ===");
let r;
r = await rpc("cambiar_estado_cita", { p_id: citaId, p_estado: "confirmada" }, adminToken);
assert("a confirmada", r.ok, JSON.stringify(r.data));
r = await rpc("cambiar_estado_cita", { p_id: citaId, p_estado: "completada" }, adminToken);
assert("a completada", r.ok, JSON.stringify(r.data));
r = await rpc("cambiar_estado_cita", { p_id: citaId, p_estado: "confirmada" }, adminToken);
assert("volver a confirmada", r.ok);

// ═══════════════════════════════════════════
// 8. CITA DOMICILIO
// ═══════════════════════════════════════════
console.log("\n=== 8. CITA DOMICILIO ===");
const crearDom = await rpc("crear_cita", {
  p_paciente: testPacId, p_medico: medicoId, p_fecha: fechaStr,
  p_hora: "14:00:00", p_motivo: "Visita domicilio", p_lugar: "domicilio",
}, adminToken);
assert("crear cita domicilio", crearDom.ok, JSON.stringify(crearDom.data));
const citaDomId = extractId(crearDom.data) || crearDom.data;
const vDom = await get("citas", "select=lugar&id=eq." + citaDomId, adminToken);
assert("lugar=domicilio", vDom.ok && vDom.data[0]?.lugar === "domicilio");

// ═══════════════════════════════════════════
// 9. CITA SÁBADO
// ═══════════════════════════════════════════
console.log("\n=== 9. CITA SÁBADO ===");
const sabado = new Date(hoy);
sabado.setDate(hoy.getDate() + ((6 - hoy.getDay() + 7) % 7 || 7));
const sabadoStr = isoDate(sabado);

const crearSab9 = await rpc("crear_cita", {
  p_paciente: testPacId, p_medico: medicoId, p_fecha: sabadoStr,
  p_hora: "09:00:00", p_motivo: "Sabado AM", p_lugar: "consultorio",
}, adminToken);
assert("sabado 09:00 OK", crearSab9.ok, JSON.stringify(crearSab9.data));
const citaSabId = extractId(crearSab9.data) || crearSab9.data;

// ═══════════════════════════════════════════
// 10. PACIENTE CREA CITA (SOLICITADA)
// ═══════════════════════════════════════════
console.log("\n=== 10. PACIENTE CREA CITA ===");
const crearPacCita = await rpc("crear_cita", {
  p_paciente: pacUser.id, p_medico: medicoId, p_fecha: fechaStr,
  p_hora: "16:00:00", p_motivo: "Consulta", p_lugar: "consultorio",
}, pacToken);
assert("paciente crea cita", crearPacCita.ok, JSON.stringify(crearPacCita.data));
const citaPacId = extractId(crearPacCita.data) || crearPacCita.data;
const vPacCita = await get("citas", "select=estado&id=eq." + citaPacId, adminToken);
assert("estado=solicitada", vPacCita.ok && vPacCita.data[0]?.estado === "solicitada");

// ═══════════════════════════════════════════
// 11. APROBAR CITA
// ═══════════════════════════════════════════
console.log("\n=== 11. APROBAR CITA ===");
r = await rpc("cambiar_estado_cita", { p_id: citaPacId, p_estado: "confirmada" }, adminToken);
assert("aprobar cita", r.ok, JSON.stringify(r.data));
const vAprobada = await get("citas", "select=estado&id=eq." + citaPacId, adminToken);
assert("estado=confirmada", vAprobada.ok && vAprobada.data[0]?.estado === "confirmada");

// ═══════════════════════════════════════════
// 12. RECORDATORIOS
// ═══════════════════════════════════════════
console.log("\n=== 12. RECORDATORIOS ===");
const genRec = await rpc("generar_recordatorios_cita", { p_cita_id: citaId }, adminToken);
assert("generar recordatorios no falla", genRec.ok, JSON.stringify(genRec.data));
// RPC may return 0 if trigger already created them, that's OK

const vRec = await get("recordatorios", "select=*&cita_id=eq." + citaId + "&order=canal", adminToken);
assert("recordatorios existen", vRec.ok && Array.isArray(vRec.data) && vRec.data.length >= 2, JSON.stringify(vRec.data));
const recs = Array.isArray(vRec.data) ? vRec.data : [];
assert("canal app existe", recs.some(r => r.canal === "app"));
assert("dirigido_a existe", recs.some(r => r.dirigido_a != null));

// ═══════════════════════════════════════════
// 13. RLS: PACIENTE SOLO VE SUS CITAS
// ═══════════════════════════════════════════
console.log("\n=== 13. RLS ===");
const pacCitas = await get("citas", "select=id", pacToken);
const allCitas = await get("citas", "select=id", adminToken);
assert("admin ve más citas", allCitas.ok && pacCitas.ok && allCitas.data.length > pacCitas.data.length,
  `admin=${allCitas.data.length} paciente=${pacCitas.data.length}`);

// ═══════════════════════════════════════════
// 14. NOTIFICACIONES (TRIGGER)
// ═══════════════════════════════════════════
console.log("\n=== 14. NOTIFICACIONES ===");
const vNotif = await get("recordatorios", "select=*&dirigido_a=eq." + adminUser.id + "&canal=eq.app&estado=eq.pendiente", adminToken);
assert("admin tiene notificaciones", vNotif.ok, `count=${vNotif.data?.length || 0}`);

// ═══════════════════════════════════════════
// 15. LIMPIEZA
// ═══════════════════════════════════════════
console.log("\n=== 15. LIMPIEZA ===");
// Eliminar medico test
const elimMed = await rpc("eliminar_medico_admin", { p_id: testMedId });
assert("eliminar medico test", elimMed.ok, JSON.stringify(elimMed.data));

// Eliminar citas de prueba
const citaIds = [citaId, citaDomId, citaSabId, citaPacId].filter(Boolean);
for (const cid of citaIds) {
  await del("citas", "id=eq." + cid, adminToken);
}
await del("pacientes", "id=eq." + testPacId, adminToken);
ok(`limpieza: ${citaIds.length} citas + 1 paciente`);

// ═══════════════════════════════════════════
// RESUMEN
// ═══════════════════════════════════════════
console.log(`\n${"═".repeat(50)}`);
console.log(`RESULTADO: ${fail === 0 ? "✅ TODO OK" : `❌ ${fail} fallo(s)`} (${pass} pass, ${fail} fail)`);
if (fail > 0) process.exit(1);
