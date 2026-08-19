-- Migración: Aprobación por médicos + alertas + buffer domicilio
-- Fecha: 2026-08-19

-- 1. Columna buffer de traslado para domicilio
ALTER TABLE public.medicos ADD COLUMN IF NOT EXISTS buffer_domicilio_min int DEFAULT 30;

-- 2. Fix trigger generar_recordatorios: eliminar hardcode psicóloga, notificar al médico asignado
CREATE OR REPLACE FUNCTION public.generar_recordatorios()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_paciente text;
  v_email_paciente text;
  v_medico text;
  v_esp text;
  v_msj text;
  v_lugar text;
  v_creador text;
  v_medico_email text;
  v_medico_user_id uuid;
  v_admin record;
BEGIN
  SELECT p.nombre, p.email INTO v_paciente, v_email_paciente
  FROM public.pacientes p WHERE p.id = new.paciente_id;

  SELECT m.nombre, m.especialidad, m.email INTO v_medico, v_esp, v_medico_email
  FROM public.medicos m WHERE m.id = new.medico_id;

  v_lugar := CASE WHEN new.lugar = 'domicilio' THEN 'a domicilio' ELSE 'en consultorio' END;

  -- Recordatorio paciente (app)
  v_msj := 'Recordatorio de cita: ' || v_paciente || ' con ' || v_medico ||
           ' (' || v_esp || ') el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
           ' a las ' || to_char(new.hora, 'HH24:MI') || '.';

  INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
  VALUES (new.id, new.paciente_id, 'app', v_msj, new.fecha + new.hora, 'pendiente');

  -- Recordatorio paciente (email)
  IF v_email_paciente IS NOT NULL AND v_email_paciente <> '' THEN
    INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
    VALUES (new.id, new.paciente_id, 'email', v_msj, new.fecha + new.hora, 'pendiente');
  END IF;

  -- Alerta al médico asignado: nueva cita solicitada
  IF v_medico_email IS NOT NULL AND v_medico_email <> '' THEN
    SELECT user_id INTO v_medico_user_id
    FROM public.perfiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE lower(u.email) = lower(v_medico_email)
    LIMIT 1;

    IF v_medico_user_id IS NOT NULL THEN
      SELECT p.nombre INTO v_creador FROM public.perfiles p WHERE p.user_id = new.creada_por;

      INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
      VALUES (
        new.id, new.paciente_id, 'app',
        'Nueva cita solicitada: ' || v_paciente || ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
          ' a las ' || to_char(new.hora, 'HH24:MI') || ' ' || v_lugar ||
          '. Motivo: ' || coalesce(new.motivo, 'No especificado') ||
          '. Agendada por ' || coalesce(v_creador, 'el sistema') || '.',
        now(), 'pendiente', v_medico_user_id
      );
    END IF;
  END IF;

  -- Alerta a todos los admins (generalizada, no solo psicóloga)
  FOR v_admin IN SELECT user_id FROM public.perfiles WHERE rol = 'admin' LOOP
    INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
    VALUES (
      new.id, new.paciente_id, 'app',
      'Nueva cita para ' || v_medico || ' (' || v_esp || '): ' || v_paciente ||
        ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
        ' a las ' || to_char(new.hora, 'HH24:MI') ||
        ' ' || v_lugar ||
        '. Agendada por ' || coalesce(v_creador, 'el sistema') || '.',
      now(), 'pendiente', v_admin.user_id
    );
  END LOOP;

  RETURN new;
END;
$$;

-- 3. Trigger AFTER UPDATE: notificar cambios de estado al médico
CREATE OR REPLACE FUNCTION public.notificar_cambio_estado()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_paciente text;
  v_medico text;
  v_esp text;
  v_lugar text;
  v_medico_email text;
  v_medico_user_id uuid;
BEGIN
  -- Solo notificar en cambios de estado relevantes
  IF old.estado = new.estado THEN RETURN new; END IF;

  SELECT p.nombre INTO v_paciente FROM public.pacientes p WHERE p.id = new.paciente_id;
  SELECT m.nombre, m.especialidad, m.email INTO v_medico, v_esp, v_medico_email
  FROM public.medicos m WHERE m.id = new.medico_id;

  v_lugar := CASE WHEN new.lugar = 'domicilio' THEN 'a domicilio' ELSE 'en consultorio' END;

  -- Buscar auth.user del médico
  IF v_medico_email IS NOT NULL AND v_medico_email <> '' THEN
    SELECT user_id INTO v_medico_user_id
    FROM public.perfiles p
    JOIN auth.users u ON u.id = p.user_id
    WHERE lower(u.email) = lower(v_medico_email)
    LIMIT 1;
  END IF;

  IF v_medico_user_id IS NULL THEN RETURN new; END IF;

  -- Cita aprobada (confirmada)
  IF new.estado = 'confirmada' AND old.estado IN ('solicitada', 'programada') THEN
    INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
    VALUES (
      new.id, new.paciente_id, 'app',
      'Cita confirmada: ' || v_paciente || ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
        ' a las ' || to_char(new.hora, 'HH24:MI') || ' ' || v_lugar || '.',
      now(), 'pendiente', v_medico_user_id
    );
  END IF;

  -- Cita completada
  IF new.estado = 'completada' AND old.estado = 'confirmada' THEN
    INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
    VALUES (
      new.id, new.paciente_id, 'app',
      'Cita completada: ' || v_paciente || ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
        ' a las ' || to_char(new.hora, 'HH24:MI') || '.',
      now(), 'pendiente', v_medico_user_id
    );
  END IF;

  -- Cita cancelada
  IF new.estado = 'cancelada' AND old.estado != 'cancelada' THEN
    INSERT INTO public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
    VALUES (
      new.id, new.paciente_id, 'app',
      'Cita cancelada: ' || v_paciente || ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
        ' a las ' || to_char(new.hora, 'HH24:MI') || '.',
      now(), 'pendiente', v_medico_user_id
    );
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS trg_notificar_estado ON public.citas;
CREATE TRIGGER trg_notificar_estado
AFTER UPDATE ON public.citas
FOR EACH ROW EXECUTE FUNCTION public.notificar_cambio_estado();

-- 4. Actualizar RPCs de médico para aceptar buffer_domicilio_min
CREATE OR REPLACE FUNCTION public.crear_medico_admin(
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time,
  p_hora_fin time,
  p_duracion int,
  p_contrasena text,
  p_hora_inicio_sabado time default null,
  p_hora_fin_sabado time default null,
  p_buffer_domicilio_min int default 30
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_dias text[];
  v_user_id uuid;
  v_medico_id uuid;
BEGIN
  IF public.rol_usuario() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede crear médicos';
  END IF;

  v_email := lower(trim(p_email));
  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_especialidad IS NULL OR trim(p_especialidad) = '' THEN RAISE EXCEPTION 'La especialidad es obligatoria'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'El email es obligatorio'; END IF;
  IF p_contrasena IS NULL OR length(p_contrasena) < 6 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres'; END IF;
  IF p_duracion IS NULL OR p_duracion <= 0 THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  IF p_hora_inicio >= p_hora_fin THEN RAISE EXCEPTION 'El horario de inicio debe ser anterior al de fin'; END IF;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN RAISE EXCEPTION 'Seleccione al menos un día de atención'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_dias) d WHERE d NOT IN ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) THEN
    RAISE EXCEPTION 'Día de atención inválido (Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo)';
  END IF;

  IF p_hora_inicio_sabado IS NOT NULL AND p_hora_fin_sabado IS NOT NULL THEN
    IF p_hora_inicio_sabado >= p_hora_fin_sabado THEN
      RAISE EXCEPTION 'El horario de sábado: inicio debe ser anterior a fin';
    END IF;
    IF NOT ('Sabado'::text = ANY(v_dias)) THEN
      RAISE EXCEPTION 'Si configura horario de sábado, debe incluir el sábado en los días de atención';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un usuario con ese email';
  END IF;
  IF EXISTS (SELECT 1 FROM public.medicos m WHERE lower(m.email) = v_email) THEN
    RAISE EXCEPTION 'Ya existe un médico con ese email';
  END IF;

  INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
    email_change, is_sso_user, is_anonymous, created_at, updated_at)
  VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, now(), now())
  RETURNING id INTO v_user_id;

  INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  VALUES (v_user_id, v_user_id, v_user_id,
          jsonb_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now(), now());

  INSERT INTO public.medicos (nombre, especialidad, telefono, email, dias_atencion,
    hora_inicio, hora_fin, duracion_cita_min, hora_inicio_sabado, hora_fin_sabado, buffer_domicilio_min)
  VALUES (trim(p_nombre), trim(p_especialidad), p_telefono, v_email, p_dias,
    p_hora_inicio, p_hora_fin, p_duracion, p_hora_inicio_sabado, p_hora_fin_sabado,
    COALESCE(p_buffer_domicilio_min, 30))
  RETURNING id INTO v_medico_id;

  INSERT INTO public.perfiles (user_id, nombre, rol, medico_id)
  VALUES (v_user_id, trim(p_nombre), 'medico', v_medico_id);

  RETURN jsonb_build_object('medico_id', v_medico_id, 'user_id', v_user_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text, time, time, int) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text, time, time, int) FROM public;

CREATE OR REPLACE FUNCTION public.actualizar_medico_admin(
  p_id uuid,
  p_nombre text,
  p_especialidad text,
  p_telefono text,
  p_email text,
  p_dias jsonb,
  p_hora_inicio time,
  p_hora_fin time,
  p_duracion int,
  p_contrasena text default null,
  p_hora_inicio_sabado time default null,
  p_hora_fin_sabado time default null,
  p_buffer_domicilio_min int default 30
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_email text;
  v_antiguo text;
  v_user_id uuid;
  v_dias text[];
BEGIN
  IF public.rol_usuario() <> 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede editar médicos';
  END IF;

  v_email := lower(trim(p_email));
  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN RAISE EXCEPTION 'El nombre es obligatorio'; END IF;
  IF p_especialidad IS NULL OR trim(p_especialidad) = '' THEN RAISE EXCEPTION 'La especialidad es obligatoria'; END IF;
  IF v_email IS NULL OR v_email = '' THEN RAISE EXCEPTION 'El email es obligatorio'; END IF;
  IF p_duracion IS NULL OR p_duracion <= 0 THEN RAISE EXCEPTION 'Duración inválida'; END IF;
  IF p_hora_inicio >= p_hora_fin THEN RAISE EXCEPTION 'El horario de inicio debe ser anterior al de fin'; END IF;

  v_dias := array(select jsonb_array_elements_text(p_dias));
  IF v_dias IS NULL OR array_length(v_dias, 1) IS NULL THEN RAISE EXCEPTION 'Seleccione al menos un día de atención'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_dias) d WHERE d NOT IN ('Lunes','Martes','Miercoles','Jueves','Viernes','Sabado','Domingo')) THEN
    RAISE EXCEPTION 'Día de atención inválido';
  END IF;

  IF p_hora_inicio_sabado IS NOT NULL AND p_hora_fin_sabado IS NOT NULL THEN
    IF p_hora_inicio_sabado >= p_hora_fin_sabado THEN
      RAISE EXCEPTION 'El horario de sábado: inicio debe ser anterior a fin';
    END IF;
    IF NOT ('Sabado'::text = ANY(v_dias)) THEN
      RAISE EXCEPTION 'Si configura horario de sábado, debe incluir el sábado en los días de atención';
    END IF;
  END IF;

  SELECT m.email, p.user_id INTO v_antiguo, v_user_id
  FROM public.medicos m LEFT JOIN public.perfiles p ON p.medico_id = m.id
  WHERE m.id = p_id;
  IF v_antiguo IS NULL THEN RAISE EXCEPTION 'Médico no encontrado'; END IF;

  IF v_email <> lower(v_antiguo) THEN
    IF EXISTS (SELECT 1 FROM auth.users u WHERE lower(u.email) = v_email AND u.id <> COALESCE(v_user_id, uuid_nil())) THEN
      RAISE EXCEPTION 'Ya existe un usuario con ese email';
    END IF;
    IF EXISTS (SELECT 1 FROM public.medicos m WHERE lower(m.email) = v_email AND m.id <> p_id) THEN
      RAISE EXCEPTION 'Ya existe un médico con ese email';
    END IF;
    UPDATE auth.users SET email = v_email, updated_at = now() WHERE id = v_user_id;
    UPDATE auth.identities
      SET identity_data = jsonb_build_object('sub', v_user_id, 'email', v_email),
          provider_id = v_user_id,
          email = v_email,
          updated_at = now()
      WHERE user_id = v_user_id;
  END IF;

  IF p_contrasena IS NOT NULL AND p_contrasena <> '' THEN
    IF length(p_contrasena) < 6 THEN RAISE EXCEPTION 'La contraseña debe tener al menos 6 caracteres'; END IF;
    UPDATE auth.users SET encrypted_password = extensions.crypt(p_contrasena, extensions.gen_salt('bf')), updated_at = now()
    WHERE id = v_user_id;
  END IF;

  UPDATE public.medicos
  SET nombre = trim(p_nombre), especialidad = trim(p_especialidad), telefono = p_telefono,
      email = v_email, dias_atencion = p_dias, hora_inicio = p_hora_inicio, hora_fin = p_hora_fin,
      duracion_cita_min = p_duracion,
      hora_inicio_sabado = p_hora_inicio_sabado, hora_fin_sabado = p_hora_fin_sabado,
      buffer_domicilio_min = COALESCE(p_buffer_domicilio_min, 30)
  WHERE id = p_id;

  UPDATE public.perfiles SET nombre = trim(p_nombre) WHERE medico_id = p_id;

  RETURN jsonb_build_object('ok', true, 'medico_id', p_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text, time, time, int) TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text, time, time, int) FROM public;
