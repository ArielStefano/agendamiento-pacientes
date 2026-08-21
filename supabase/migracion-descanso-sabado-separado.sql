-- ============================================================
-- Migracion: Descanso separado lunes-viernes vs sabado
-- Agrega columnas hora_inicio_descanso_sabado y hora_fin_descanso_sabado
-- ============================================================

-- 1. Agregar columnas
ALTER TABLE public.medicos ADD COLUMN IF NOT EXISTS hora_inicio_descanso_sabado time;
ALTER TABLE public.medicos ADD COLUMN IF NOT EXISTS hora_fin_descanso_sabado time;
