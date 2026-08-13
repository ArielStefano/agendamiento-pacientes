-- ============================================================
--  Datos de demostración
--  Ejecutar DESPUÉS de schema.sql en el SQL Editor
-- ============================================================

insert into public.medicos (id, nombre, especialidad, telefono, email, dias_atencion, hora_inicio, hora_fin, duracion_cita_min) values
  ('10000000-0000-4000-8000-000000000001', 'Dra. Ana López',    'Cardiología',     '555-0101', 'ana@clinica.com',    '["Lunes","Martes","Miercoles","Jueves"]', '08:00:00', '14:00:00', 30),
  ('10000000-0000-4000-8000-000000000002', 'Dr. Carlos Mendoza','Pediatría',       '555-0102', 'carlos@clinica.com', '["Lunes","Martes","Miercoles","Jueves","Viernes"]', '09:00:00', '17:00:00', 30),
  ('10000000-0000-4000-8000-000000000003', 'Dra. Lucía Fernández','Dermatología', '555-0103', 'lucia@clinica.com',   '["Miercoles","Jueves","Viernes"]', '10:00:00', '16:00:00', 45);

insert into public.pacientes (id, documento, nombre, email, telefono, fecha_nacimiento, direccion, alergias, notas) values
  ('20000000-0000-4000-8000-000000000001', 'DNI-1023456789', 'Juan Pérez',    'juan.perez@example.com',     '555-1001', '1985-04-12', 'Av. Central 123', 'Ninguna',          'Paciente de control anual'),
  ('20000000-0000-4000-8000-000000000002', 'DNI-9876543210', 'María González','maria.gonzalez@example.com', '555-1002', '1990-11-03', 'Calle Luna 45',   'Penicilina',       'Alergia a la penicilina'),
  ('20000000-0000-4000-8000-000000000003', 'DNI-4561237890', 'Pedro Ramírez', 'pedro.ramirez@example.com',  '555-1003', '1978-07-22', 'Av. Sol 890',     'Ninguna',          null),
  ('20000000-0000-4000-8000-000000000004', 'DNI-3216549870', 'Laura Torres',  'laura.torres@example.com',   '555-1004', '2001-02-15', 'Calle Mar 67',   'Ninguna',          'Paciente pediátrico'),
  ('20000000-0000-4000-8000-000000000005', 'DNI-7418529630', 'Sofía Castillo','sofia.castillo@example.com', '555-1005', '1995-09-30', 'Av. Norte 234',  'Frutos secos',     null);

-- El trigger generar_recordatorios crea los recordatorios de estas citas automáticamente.
insert into public.citas (paciente_id, medico_id, fecha, hora, duracion_min, motivo, estado) values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', current_date,             '09:00:00', 30, 'Control cardiológico',  'confirmada'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', current_date,             '09:30:00', 30, 'Dolor en el pecho',     'programada'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', current_date + 1,         '10:00:00', 30, 'Revisión general',      'programada'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000002', current_date + 1,         '10:30:00', 30, 'Vacunación',            'programada'),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', current_date + 2,         '11:00:00', 45, 'Consulta dermatológica','programada');
