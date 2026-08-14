-- ============================================================
--  Migración: autorregistro de pacientes (paciente o representante)
--  Permite que un paciente/representante cree su propio usuario
--  desde una página pública (mismo patrón de crear_medico_admin,
--  pero ejecutable por usuarios anónimos).
--  Ejecutar DESPUÉS de migracion-admin-medicos-recordatorios.sql
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 1) Nuevo rol 'paciente' en perfiles ----------

alter table public.perfiles drop constraint perfiles_rol_check;

alter table public.perfiles
  add constraint perfiles_rol_check
  check (rol in ('admin', 'medico', 'recepcion', 'paciente'));

-- Enlace del perfil con la ficha del paciente (solo para rol 'paciente')
alter table public.perfiles add column if not exists paciente_id uuid references public.pacientes (id) on delete cascade;

-- ---------- 2) Helper: paciente_id del usuario autenticado ----------

create or replace function public.paciente_id_usuario()
returns uuid
language sql stable security definer set search_path = public
as $$
  select p.paciente_id from public.perfiles p where p.user_id = auth.uid()
$$;

grant execute on function public.paciente_id_usuario() to authenticated;

-- ---------- 3) RPC: registrar paciente (crea usuario + ficha + perfil) ----------

create or replace function public.registrar_paciente(
  p_nombre text,
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
begin
  v_email := lower(trim(p_email));
  if p_nombre is null or trim(p_nombre) = '' then raise exception 'El nombre es obligatorio'; end if;
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
  values (nullif(trim(p_documento), ''), trim(p_nombre), v_email, p_telefono, p_fecha_nacimiento, p_direccion, p_alergias)
  returning id into v_paciente_id;

  insert into public.perfiles (user_id, nombre, rol, paciente_id)
  values (v_user_id, trim(p_nombre), 'paciente', v_paciente_id);

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- Accesible por cualquiera (página pública de registro) y por usuarios autenticados
grant execute on function public.registrar_paciente(text, text, text, text, date, text, text, text) to anon, authenticated;
revoke all on function public.registrar_paciente(text, text, text, text, date, text, text, text) from public;
