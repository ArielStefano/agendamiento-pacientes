-- Migración: Sistema de descanso + fix horario sábado Josselyn
-- Fecha: 2026-08-19

-- 1. Columnas de descanso
ALTER TABLE public.medicos ADD COLUMN IF NOT EXISTS hora_inicio_descanso time;
ALTER TABLE public.medicos ADD COLUMN IF NOT EXISTS hora_fin_descanso time;

-- 2. Fix horario sábado Josselyn: 08:00-17:00 + descanso 13:00-17:00
UPDATE public.medicos
SET hora_fin_sabado = '17:00:00',
    hora_inicio_descanso = '13:00:00',
    hora_fin_descanso = '17:00:00'
WHERE email = 'jtoaquiza@clinica.com';

-- 3. Actualizar crear_medico_admin con parámetros de descanso
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
  p_buffer_domicilio_min int default 30,
  p_hora_inicio_descanso time default null,
  p_hora_fin_descanso time default null
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

  IF (p_hora_inicio_descanso IS NULL) <> (p_hora_fin_descanso IS NULL) THEN
    RAISE EXCEPTION 'Si configura descanso, debe indicar inicio y fin';
  END IF;
  IF p_hora_inicio_descanso IS NOT NULL AND p_hora_fin_descanso IS NOT NULL THEN
    IF p_hora_inicio_descanso >= p_hora_fin_descanso THEN
      RAISE EXCEPTION 'El descanso: inicio debe ser anterior a fin';
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
    hora_inicio, hora_fin, duracion_cita_min, hora_inicio_sabado, hora_fin_sabado,
    buffer_domicilio_min, hora_inicio_descanso, hora_fin_descanso)
  VALUES (trim(p_nombre), trim(p_especialidad), p_telefono, v_email, p_dias,
    p_hora_inicio, p_hora_fin, p_duracion, p_hora_inicio_sabado, p_hora_fin_sabado,
    COALESCE(p_buffer_domicilio_min, 30), p_hora_inicio_descanso, p_hora_fin_descanso)
  RETURNING id INTO v_medico_id;

  INSERT INTO public.perfiles (user_id, nombre, rol, medico_id)
  VALUES (v_user_id, trim(p_nombre), 'medico', v_medico_id);

  RETURN jsonb_build_object('medico_id', v_medico_id, 'user_id', v_user_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text, time, time, int, time, time) TO authenticated;
REVOKE ALL ON FUNCTION public.crear_medico_admin(text, text, text, text, jsonb, time, time, int, text, time, time, int, time, time) FROM public;

-- 4. Actualizar actualizar_medico_admin con parámetros de descanso
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
  p_buffer_domicilio_min int default 30,
  p_hora_inicio_descanso time default null,
  p_hora_fin_descanso time default null
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

  IF (p_hora_inicio_descanso IS NULL) <> (p_hora_fin_descanso IS NULL) THEN
    RAISE EXCEPTION 'Si configura descanso, debe indicar inicio y fin';
  END IF;
  IF p_hora_inicio_descanso IS NOT NULL AND p_hora_fin_descanso IS NOT NULL THEN
    IF p_hora_inicio_descanso >= p_hora_fin_descanso THEN
      RAISE EXCEPTION 'El descanso: inicio debe ser anterior a fin';
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
      buffer_domicilio_min = COALESCE(p_buffer_domicilio_min, 30),
      hora_inicio_descanso = p_hora_inicio_descanso, hora_fin_descanso = p_hora_fin_descanso
  WHERE id = p_id;

  UPDATE public.perfiles SET nombre = trim(p_nombre) WHERE medico_id = p_id;

  RETURN jsonb_build_object('ok', true, 'medico_id', p_id, 'email', v_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text, time, time, int, time, time) TO authenticated;
REVOKE ALL ON FUNCTION public.actualizar_medico_admin(uuid, text, text, text, text, jsonb, time, time, int, text, time, time, int, time, time) FROM public;
