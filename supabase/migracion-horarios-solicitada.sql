-- ============================================================
--  Migración: horarios, estado 'solicitada', pacientes agendan
--  Ejecutar DESPUÉS de migracion-representantes.sql
-- ============================================================

-- 1) Horario de Josselyn: Lunes a Sábado, 8 a 17h
update public.medicos
set dias_atencion = '["Lunes","Martes","Miercoles","Jueves","Viernes","Sabado"]'::jsonb,
    hora_inicio   = '08:00:00',
    hora_fin      = '17:00:00'
where email = 'jtoaquiza@clinica.com';

-- 2) Nuevo estado 'solicitada' (cita pedida por paciente, pendiente de aprobación)
alter table public.citas drop constraint if exists citas_estado_check;
alter table public.citas add constraint citas_estado_check
  check (estado in ('solicitada', 'programada', 'confirmada', 'completada', 'cancelada'));

-- 3) cambiar_estado_cita: aceptar 'solicitada' como valor válido
create or replace function public.cambiar_estado_cita(p_id uuid, p_estado text)
returns public.citas
language plpgsql security definer set search_path = public
as $$
declare
  v_cita public.citas;
  v_rol text;
begin
  if p_estado not in ('solicitada', 'programada', 'confirmada', 'completada', 'cancelada') then
    raise exception 'Estado inválido';
  end if;

  v_rol := public.rol_usuario();
  select * into v_cita from public.citas where id = p_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;

  if v_rol not in ('admin', 'recepcion')
     and not (v_rol = 'medico' and v_cita.medico_id = public.medico_id_usuario()) then
    raise exception 'Sin permisos para cambiar el estado de esta cita';
  end if;

  update public.citas set estado = p_estado, updated_at = now()
  where id = p_id
  returning * into v_cita;

  return v_cita;
end;
$$;

-- 4) crear_cita: permitir rol 'paciente' → estado 'solicitada'
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
  v_rol text;
  v_estado text;
begin
  v_rol := public.rol_usuario();
  if v_rol is null then
    raise exception 'Debe iniciar sesión';
  end if;
  if v_rol not in ('admin', 'recepcion', 'medico', 'paciente') then
    raise exception 'Sin permisos para crear citas';
  end if;

  -- Paciente solo puede crear para sí mismo y queda como 'solicitada'
  if v_rol = 'paciente' then
    p_paciente := public.paciente_id_usuario();
    if p_paciente is null then
      raise exception 'Su perfil de paciente no está completo';
    end if;
    v_estado := 'solicitada';
  else
    v_estado := 'programada';
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

  insert into public.citas (paciente_id, medico_id, fecha, hora, duracion_min, motivo, lugar, estado, creada_por)
  values (p_paciente, p_medico, p_fecha, p_hora, v_dur, p_motivo, p_lugar, v_estado, auth.uid())
  returning * into v_cita;

  return v_cita;
end;
$$;

-- 5) RLS: paciente ve sus propias citas
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'citas_sel_paciente' and tablename = 'citas') then
    create policy "citas_sel_paciente" on public.citas
      for select to authenticated
      using (public.rol_usuario() = 'paciente' and public.paciente_id_usuario() = paciente_id);
  end if;
end $$;
