-- ============================================================
--  Migración: lugar de cita (consultorio/domicilio) + alertas
--  de nuevas citas de la psicóloga (Josselyn Toaquiza) al admin
--  Ejecutar DESPUÉS de schema.sql y seed.sql en el SQL Editor
-- ============================================================

-- 1) Columna "lugar" en citas
alter table public.citas
  add column if not exists lugar text not null default 'consultorio'
  check (lugar in ('consultorio', 'domicilio'));

-- 2) Columna "dirigido_a" en recordatorios (NULL = visible para todos)
alter table public.recordatorios
  add column if not exists dirigido_a uuid references auth.users (id) on delete cascade;

-- ---------- RPC: crear cita con lugar ----------

drop function if exists public.crear_cita(uuid, uuid, date, time, text);

create or replace function public.crear_cita(
  p_paciente uuid,
  p_medico uuid,
  p_fecha date,
  p_hora time,
  p_motivo text default null,
  p_lugar text default 'consultorio'
)
returns public.citas
language plpgsql security definer set search_path = public
as $$
declare
  v_medico public.medicos%rowtype;
  v_dia text;
  v_dur int;
  v_conflicto int;
  v_cita public.citas;
begin
  if public.rol_usuario() is null then
    raise exception 'Debe iniciar sesión';
  end if;
  if public.rol_usuario() not in ('admin', 'recepcion', 'medico') then
    raise exception 'Sin permisos para crear citas';
  end if;

  if p_lugar is null then p_lugar := 'consultorio'; end if;
  if p_lugar not in ('consultorio', 'domicilio') then
    raise exception 'Lugar inválido (debe ser consultorio o domicilio)';
  end if;

  select * into v_medico from public.medicos where id = p_medico for update;
  if not found then
    raise exception 'Médico no encontrado';
  end if;

  if p_fecha < current_date then
    raise exception 'No se pueden agendar citas en el pasado';
  end if;

  v_dia := case extract(isodow from p_fecha)
    when 1 then 'Lunes' when 2 then 'Martes' when 3 then 'Miercoles'
    when 4 then 'Jueves' when 5 then 'Viernes' when 6 then 'Sabado'
    when 7 then 'Domingo' end;

  if not (v_medico.dias_atencion ? v_dia) then
    raise exception 'El médico no atiende ese día (%)', v_dia;
  end if;

  v_dur := v_medico.duracion_cita_min;

  if p_hora < v_medico.hora_inicio
     or p_hora + v_dur * interval '1 minute' > v_medico.hora_fin then
    raise exception 'La cita debe estar dentro del horario del médico (%)',
      v_medico.hora_inicio || ' - ' || v_medico.hora_fin;
  end if;

  select count(*) into v_conflicto
  from public.citas
  where medico_id = p_medico and fecha = p_fecha and estado <> 'cancelada'
    and hora < (p_hora + v_dur * interval '1 minute')
    and p_hora < (hora + duracion_min * interval '1 minute');

  if v_conflicto > 0 then
    raise exception 'Horario no disponible: el médico ya tiene una cita en ese rango';
  end if;

  insert into public.citas (paciente_id, medico_id, fecha, hora, duracion_min, motivo, lugar, creada_por)
  values (p_paciente, p_medico, p_fecha, p_hora, v_dur, p_motivo, p_lugar, auth.uid())
  returning * into v_cita;

  return v_cita;
end;
$$;

grant execute on function public.crear_cita(uuid, uuid, date, time, text, text) to authenticated;
revoke all on function public.crear_cita(uuid, uuid, date, time, text, text) from public;

-- ---------- RPC: reprogramar cita con lugar ----------

drop function if exists public.actualizar_cita(uuid, uuid, uuid, date, time, text);

create or replace function public.actualizar_cita(
  p_id uuid,
  p_paciente uuid,
  p_medico uuid,
  p_fecha date,
  p_hora time,
  p_motivo text default null,
  p_lugar text default 'consultorio'
)
returns public.citas
language plpgsql security definer set search_path = public
as $$
declare
  v_cita_actual public.citas%rowtype;
  v_medico public.medicos%rowtype;
  v_dia text;
  v_dur int;
  v_conflicto int;
  v_cita public.citas;
begin
  if public.rol_usuario() not in ('admin', 'recepcion') then
    raise exception 'Sin permisos para reprogramar citas';
  end if;

  if p_lugar is null then p_lugar := 'consultorio'; end if;
  if p_lugar not in ('consultorio', 'domicilio') then
    raise exception 'Lugar inválido (debe ser consultorio o domicilio)';
  end if;

  select * into v_cita_actual from public.citas where id = p_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;

  select * into v_medico from public.medicos where id = p_medico for update;
  if not found then
    raise exception 'Médico no encontrado';
  end if;

  if p_fecha < current_date then
    raise exception 'No se pueden agendar citas en el pasado';
  end if;

  v_dia := case extract(isodow from p_fecha)
    when 1 then 'Lunes' when 2 then 'Martes' when 3 then 'Miercoles'
    when 4 then 'Jueves' when 5 then 'Viernes' when 6 then 'Sabado'
    when 7 then 'Domingo' end;

  if not (v_medico.dias_atencion ? v_dia) then
    raise exception 'El médico no atiende ese día (%)', v_dia;
  end if;

  v_dur := v_medico.duracion_cita_min;

  if p_hora < v_medico.hora_inicio
     or p_hora + v_dur * interval '1 minute' > v_medico.hora_fin then
    raise exception 'La cita debe estar dentro del horario del médico (%)',
      v_medico.hora_inicio || ' - ' || v_medico.hora_fin;
  end if;

  select count(*) into v_conflicto
  from public.citas
  where medico_id = p_medico and fecha = p_fecha and estado <> 'cancelada'
    and id <> p_id
    and hora < (p_hora + v_dur * interval '1 minute')
    and p_hora < (hora + duracion_min * interval '1 minute');

  if v_conflicto > 0 then
    raise exception 'Horario no disponible: el médico ya tiene una cita en ese rango';
  end if;

  update public.citas
  set paciente_id = p_paciente, medico_id = p_medico, fecha = p_fecha, hora = p_hora,
      duracion_min = v_dur, motivo = p_motivo, lugar = p_lugar, updated_at = now()
  where id = p_id
  returning * into v_cita;

  return v_cita;
end;
$$;

grant execute on function public.actualizar_cita(uuid, uuid, uuid, date, time, text, text) to authenticated;
revoke all on function public.actualizar_cita(uuid, uuid, uuid, date, time, text, text) from public;

-- ---------- Trigger: + alerta al admin para citas de la psicóloga ----------

create or replace function public.generar_recordatorios()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_paciente text;
  v_email text;
  v_medico text;
  v_esp text;
  v_msj text;
  v_lugar text;
  v_creador text;
  v_admin record;
begin
  select p.nombre, p.email into v_paciente, v_email
  from public.pacientes p where p.id = new.paciente_id;

  select m.nombre, m.especialidad into v_medico, v_esp
  from public.medicos m where m.id = new.medico_id;

  v_msj := 'Recordatorio de cita: ' || v_paciente || ' con ' || v_medico ||
           ' (' || v_esp || ') el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
           ' a las ' || to_char(new.hora, 'HH24:MI') || '.';

  insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
  values (new.id, new.paciente_id, 'app', v_msj, new.fecha + new.hora, 'pendiente');

  if v_email is not null and v_email <> '' then
    insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado)
    values (new.id, new.paciente_id, 'email', v_msj, new.fecha + new.hora, 'pendiente');
  end if;

  -- Alerta inmediata para los admins cuando la cita es de la psicóloga
  if exists (select 1 from public.medicos m where m.id = new.medico_id and m.email = 'jtoaquiza@clinica.com') then
    v_lugar := case when new.lugar = 'domicilio' then 'a domicilio' else 'en consultorio' end;

    select p.nombre into v_creador from public.perfiles p where p.user_id = new.creada_por;

    for v_admin in select user_id from public.perfiles where rol = 'admin' loop
      insert into public.recordatorios (cita_id, paciente_id, canal, mensaje, fecha_programada, estado, dirigido_a)
      values (
        new.id,
        new.paciente_id,
        'app',
        'Nueva cita para ' || v_medico || ' (' || v_esp || '): ' || v_paciente ||
          ' el ' || to_char(new.fecha, 'DD/MM/YYYY') ||
          ' a las ' || to_char(new.hora, 'HH24:MI') ||
          ' ' || v_lugar ||
          '. Agendada por ' || coalesce(v_creador, 'el sistema') || '.',
        now(),
        'pendiente',
        v_admin.user_id
      );
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_generar_recordatorios on public.citas;
create trigger trg_generar_recordatorios
after insert on public.citas
for each row execute function public.generar_recordatorios();

-- ---------- RLS: recordatorios filtrados por dirigido_a ----------

drop policy if exists "recordatorios_sel" on public.recordatorios;
create policy "recordatorios_sel" on public.recordatorios for select to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid());

drop policy if exists "recordatorios_upd" on public.recordatorios;
create policy "recordatorios_upd" on public.recordatorios for update to authenticated
  using (dirigido_a is null or dirigido_a = auth.uid());
