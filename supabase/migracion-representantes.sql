-- ============================================================
--  Migración: cuenta del paciente o del representante
--  La persona que se registra elige si es el paciente o un
--  representante. Se guarda el nombre del paciente (ficha) y,
--  si aplica, el nombre de quien usa la cuenta.
--  Ejecutar DESPUÉS de migracion-pacientes-autorregistro.sql
-- ============================================================

-- Marca en el perfil si la cuenta pertenece a un representante
alter table public.perfiles add column if not exists representante boolean not null default false;

-- ---------- RPC: registrar paciente o representante ----------

create or replace function public.registrar_paciente(
  p_nombre_paciente text,
  p_es_representante boolean,
  p_nombre_cuenta text,
  p_documento text,
  p_email text,
  p_telefono text,
  p_fecha_nacimiento date,
  p_direccion text,
  p_alergias text,
  p_contrasena text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_user_id uuid;
  v_paciente_id uuid;
  v_nombre_cuenta text;
begin
  v_email := lower(trim(p_email));
  if p_nombre_paciente is null or trim(p_nombre_paciente) = '' then
    raise exception 'El nombre del paciente es obligatorio';
  end if;
  if coalesce(p_es_representante, false) then
    if p_nombre_cuenta is null or trim(p_nombre_cuenta) = '' then
      raise exception 'El nombre del representante es obligatorio';
    end if;
    v_nombre_cuenta := trim(p_nombre_cuenta);
  else
    v_nombre_cuenta := trim(p_nombre_paciente);
  end if;
  if v_email is null or v_email = '' then raise exception 'El email es obligatorio'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'El email no es válido'; end if;
  if p_contrasena is null or length(p_contrasena) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;

  if exists (select 1 from auth.users u where lower(u.email) = v_email) then
    raise exception 'Ya existe una cuenta con ese email';
  end if;
  if p_documento is not null and trim(p_documento) <> ''
     and exists (select 1 from public.pacientes pa where lower(pa.documento) = lower(trim(p_documento))) then
    raise exception 'Ya existe un paciente registrado con ese documento';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new,
    email_change, is_sso_user, is_anonymous, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
    extensions.crypt(p_contrasena, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, '', '', '', '', false, false, now(), now())
  returning id into v_user_id;

  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_user_id, v_user_id, v_user_id,
          jsonb_build_object('sub', v_user_id, 'email', v_email), 'email', now(), now(), now());

  insert into public.pacientes (documento, nombre, email, telefono, fecha_nacimiento, direccion, alergias)
  values (nullif(trim(p_documento), ''), trim(p_nombre_paciente), v_email, p_telefono, p_fecha_nacimiento, p_direccion, p_alergias)
  returning id into v_paciente_id;

  insert into public.perfiles (user_id, nombre, rol, paciente_id, representante)
  values (v_user_id, v_nombre_cuenta, 'paciente', v_paciente_id, coalesce(p_es_representante, false));

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

grant execute on function public.registrar_paciente(text, boolean, text, text, text, text, date, text, text, text) to anon, authenticated;
revoke all on function public.registrar_paciente(text, boolean, text, text, text, text, date, text, text, text) from public;
