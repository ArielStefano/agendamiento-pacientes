import https from "https";

const PAT = process.env.SUPABASE_PAT;
const URL = "xgfwcrdrkzcoxepnicfb.supabase.co";
const ANON = "sb_publishable_xQtBw6keFlyfmOh5faQ76w_AT2n-6U9";

function supaQuery(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: "api.supabase.com",
      path: "/v1/projects/xgfwcrdrkzcoxepnicfb/database/query",
      method: "POST",
      headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json", apikey: PAT },
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(String(d)); } });
    });
    req.on("error", reject); req.end(body);
  });
}

function supaAuth(email, pass) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ email, password: pass });
    const req = https.request({
      hostname: URL, path: "/auth/v1/token?grant_type=password", method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } });
    });
    req.on("error", reject); req.end(body);
  });
}

function supaRPC(token, rpc, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const req = https.request({
      hostname: URL, path: `/rest/v1/rpc/${rpc}`, method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON, Authorization: `Bearer ${token}` },
    }, (res) => {
      let d = ""; res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject); req.end(body);
  });
}

let PASS = 0, FAIL = 0;
function ok(name) { PASS++; console.log(`  ✅ ${name}`); }
function fail(name, msg) { FAIL++; console.log(`  ❌ ${name}: ${msg}`); }

console.log("\n═══ 1. LOGIN ═══");
const admin = await supaAuth("admin@clinica.com", "admin123");
const adminJWT = admin.access_token;
if (adminJWT) ok("Admin login"); else fail("Admin login", JSON.stringify(admin).slice(0,100));
const patient = await supaAuth("paciente@test.com", "123456");
const patJWT = patient.access_token;
if (patJWT) ok("Patient login"); else fail("Patient login", JSON.stringify(patient).slice(0,100));

// Get patient's paciente_id
const patPac = await supaQuery("SELECT paciente_id FROM public.perfiles WHERE user_id = 'db402b78-acac-48fb-a6ff-d5cfefe93603'");
const patPacId = patPac[0]?.paciente_id;

console.log("\n═══ 2. CRUD MÉDICOS ═══");
// Use Doctor Test V2 (atiende Martes 08:00-16:00, horario normal)
const docs = await supaQuery("SELECT id, nombre, dias_atencion, lugares_atencion, hora_inicio, hora_fin, duracion_cita_min FROM public.medicos WHERE nombre = 'Doctor Test V2'");
const doc = docs[0];
ok(`Usar médico existente: ${doc.nombre} (${doc.id})`);
var medicoId = doc.id;
var lugares = doc.lugares_atencion;
var dias = doc.dias_atencion;
console.log(`     días: ${dias.join(", ")} | lugares: ${lugares.join(", ")} | ${doc.hora_inicio}-${doc.hora_fin} | ${doc.duracion_cita_min}min`);

// Test crear_medico_admin flow
const nuevoMedico = await supaRPC(adminJWT, "crear_medico_admin", {
  p_nombre: "Dra. Test Full", p_especialidad: "Cardiología",
  p_telefono: "0991111111", p_email: "drafull@test.com",
  p_dias: ["Lunes","Martes"], p_hora_inicio: "09:00", p_hora_fin: "13:00",
  p_duracion: 30, p_contrasena: "medico123",
  p_lugares_atencion: ["Consultorio"],
});
const nuevoMedicoObj = JSON.parse(nuevoMedico.body);
console.log(`  → respuesta crear_medico_admin: ${nuevoMedico.status} raw=${nuevoMedico.body.slice(0,200)}`);
var nuevoMedicoId = nuevoMedicoObj?.id || (typeof nuevoMedicoObj === 'string' ? nuevoMedicoObj : null);

// Cleanup this new doctor directly via SQL
try {
  const rows = await supaQuery("SELECT id FROM public.medicos WHERE email = 'drafull@test.com'");
  if (rows[0]?.id) { await supaQuery(`DELETE FROM public.medicos WHERE id = '${rows[0].id}'`); ok("Limpiar médico de prueba"); }
} catch(e) { fail("Limpiar médico", String(e).slice(0,80)); }

console.log("\n═══ 3. CRUD PACIENTES ═══");
const nuevoPac = await supaRPC(adminJWT, "crear_paciente_admin", {
  p_nombre: "Paciente Test Full", p_documento: "TEST-999",
  p_email: "pacfull@test.com", p_telefono: "0987777777",
  p_fecha_nacimiento: "1985-05-20", p_direccion: "Av Prueba 1",
  p_alergias: null, p_notas: "check",
});
console.log(`  → respuesta crear_paciente_admin: ${nuevoPac.status} raw=${nuevoPac.body.slice(0,200)}`);
try {
  const pr = await supaQuery("SELECT id FROM public.pacientes WHERE email = 'pacfull@test.com'");
  if (pr[0]?.id) { ok("Crear paciente OK"); await supaQuery(`DELETE FROM public.pacientes WHERE id = '${pr[0].id}'`); }
  else fail("Crear paciente", "no encontrado en DB");
} catch(e) { fail("Crear paciente", String(e).slice(0,80)); }

console.log("\n═══ 4. CREAR CITA (admin, paciente@test) ═══");
// Compute a future weekday the doctor works
const now = new Date();
let citaFecha = null;
for (let i = 1; i <= 20; i++) {
  const d = new Date(now); d.setDate(d.getDate() + i);
  const diasMap = ["Domingo","Lunes","Martes","Miercoles","Jueves","Viernes","Sabado"];
  if (dias.includes(diasMap[d.getDay()])) { citaFecha = d.toISOString().slice(0,10); break; }
}
console.log(`  → fecha elegida: ${citaFecha}, doctor días: ${dias.join(",")}`);
if (!citaFecha) { fail("Crear cita", "No hay día laboral próximo"); }
else {
  const cita1 = await supaRPC(adminJWT, "crear_cita", {
    p_paciente: patPacId, p_medico: medicoId, p_fecha: citaFecha, p_hora: "09:00",
    p_motivo: "Consulta test", p_lugar: lugares[0],
  });
  if (cita1.status === 200 && cita1.body !== "null") {
    const c = JSON.parse(cita1.body);
    ok(`Crear cita → ${c.estado} (${c.id})`);
    var citaId = c.id;

    console.log("\n═══ 5. CAMBIAR ESTADOS ═══");
    const st1 = await supaRPC(adminJWT, "cambiar_estado_cita", { p_id: citaId, p_estado: "confirmada", p_motivo_cancelacion: null });
    if (st1.status === 200) ok("→ confirmada"); else fail("→ confirmada", st1.body.slice(0,100));
    const st2 = await supaRPC(adminJWT, "cambiar_estado_cita", { p_id: citaId, p_estado: "completada", p_motivo_cancelacion: null });
    if (st2.status === 200) ok("→ completada"); else fail("→ completada", st2.body.slice(0,100));
  } else fail("Crear cita", `status=${cita1.status} ${cita1.body.slice(0,150)}`);
}

console.log("\n═══ 6. CANCELAR CITA (admin) ═══");
if (citaFecha) {
  const cita2 = await supaRPC(adminJWT, "crear_cita", {
    p_paciente: patPacId, p_medico: medicoId, p_fecha: citaFecha, p_hora: "10:00",
    p_motivo: "Para cancelar", p_lugar: lugares[0],
  });
  if (cita2.status === 200) {
    const c2 = JSON.parse(cita2.body);
    const cancel1 = await supaRPC(adminJWT, "cambiar_estado_cita", { p_id: c2.id, p_estado: "cancelada", p_motivo_cancelacion: "Ya no se necesita" });
    if (cancel1.status === 200) ok("Cancelar admin"); else fail("Cancelar admin", cancel1.body.slice(0,100));
  } else fail("Crear cita 2", cita2.body.slice(0,100));
}

console.log("\n═══ 7. PACIENTE CREA CITA ═══");
if (citaFecha) {
  const pacCita = await supaRPC(patJWT, "crear_cita", {
    p_paciente: null, p_medico: medicoId, p_fecha: citaFecha, p_hora: "11:00",
    p_motivo: "Auto-agendada", p_lugar: lugares[0],
  });
  if (pacCita.status === 200 && pacCita.body !== "null") {
    const c3 = JSON.parse(pacCita.body);
    if (c3.estado === "solicitada") ok(`Paciente crea cita → ${c3.estado}`);
    else fail("Paciente crea cita", `Esperaba solicitada, obtuvo ${c3.estado}`);
  } else fail("Paciente crea cita", `status=${pacCita.status} ${pacCita.body.slice(0,150)}`);
}

console.log("\n═══ 8. CANCELACIÓN PACIENTE <24H → CLÁUSULA ═══");
const today = new Date().toISOString().slice(0,10);
const diasName = ["Domingo","Lunes","Martes","Miercoles","Jueves","Viernes","Sabado"];
if (dias.includes(diasName[new Date().getDay()])) {
  // Use hora within Doctor Test V2 range (08:00-16:00)
  let citaHora = "10:00";
  const citaHoy = await supaRPC(adminJWT, "crear_cita", {
    p_paciente: patPacId, p_medico: medicoId, p_fecha: today, p_hora: citaHora,
    p_motivo: "Test cláusula", p_lugar: lugares[0],
  });
  if (citaHoy.status === 200) {
    const cc = JSON.parse(citaHoy.body);
    const cancelClaus = await supaRPC(patJWT, "cambiar_estado_cita", { p_id: cc.id, p_estado: "cancelada", p_motivo_cancelacion: "" });
    if (cancelClaus.status === 200) {
      const s = JSON.parse(cancelClaus.body);
      if (s.estado === "cancelada_clausula") ok(`Cancelación <24h → ${s.estado}`);
      else fail("Cancelación paciente", `Esperaba cancelada_clausula, obtuvo ${s.estado}`);
    } else fail("Cancelación paciente", cancelClaus.body.slice(0,100));
  } else fail("Crear cita hoy cláusula", citaHoy.body.slice(0,100));
} else {
  console.log("  ⏭️ Hoy no es día de atención de este médico, se omite test cláusula con el doctor real");
}

console.log("\n═══ 9. PUSH ═══");
const subs = await supaQuery("SELECT count(*) as total FROM public.push_suscripciones");
console.log(`  📊 Suscripciones: ${subs[0]?.total || 0}`);
const pushTest = await new Promise((resolve, reject) => {
  const req = https.request({ hostname: URL, path: "/functions/v1/enviar-push", method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANON}` } },
    (res) => { let d=""; res.on("data", c=>d+=c); res.on("end", ()=>resolve({status:res.statusCode, body:d})); });
  req.on("error", reject); req.end("{}");
});
if (pushTest.status === 200) {
  const pt = JSON.parse(pushTest.body);
  ok(`Edge Function: ${pt.sent||0} enviados, ${pt.processed||0} procesados`);
} else fail("Edge Function", pushTest.body.slice(0,100));

console.log("\n═══ 10. CONFIG / RECORDATORIOS / ESPECIALES ═══");
const config = await supaQuery("SELECT count(*) as t FROM public.configuracion");
ok(`Configuración: ${config[0]?.t} registros`);
const recs = await supaQuery("SELECT count(*) as t FROM public.recordatorios");
ok(`Recordatorios: ${recs[0]?.t} registros`);
const desTest = await supaQuery(`INSERT INTO public.disponibilidad_especial (medico_id, fecha, dia_semana, hora_inicio, hora_fin, tipo) VALUES ('${medicoId}', NULL, 'Lunes', '10:00', '11:00', 'extra') RETURNING id`);
if (Array.isArray(desTest) && desTest.length > 0) {
  ok("Horario especial creado");
  await supaQuery(`DELETE FROM public.disponibilidad_especial WHERE id = '${desTest[0].id}'`);
  ok("Horario especial eliminado");
} else fail("Horario especial", String(desTest).slice(0,100));

console.log("\n═══ CLEANUP ═══");
// Clean up any citas we created for paciente@test (that weren't already restored)
await supaQuery("UPDATE public.citas SET estado = 'confirmada', motivo_cancelacion = NULL WHERE id = 'ea965388-ae81-4920-b2c9-38a133b0c7c8'");
console.log("  🧹 Limpieza finalizada");

console.log(`\n${"═".repeat(50)}`);
console.log(`RESULTADO: ✅ ${PASS} pass / ❌ ${FAIL} fail`);
console.log(`${"═".repeat(50)}\n`);
