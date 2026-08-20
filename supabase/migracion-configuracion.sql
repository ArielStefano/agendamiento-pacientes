-- ============================================================
-- Migración: Tabla configuracion + RPCs
-- CliniAgenda - Sistema de agendamiento de pacientes
-- ============================================================

-- 1. Tabla configuracion
CREATE TABLE IF NOT EXISTS configuracion (
  clave text PRIMARY KEY,
  valor jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

-- 2. RLS: todos leen, solo admin escribe
ALTER TABLE configuracion ENABLE ROW LEVEL SECURITY;

CREATE POLICY "configuracion_select" ON configuracion
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "configuracion_insert_admin" ON configuracion
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM perfiles WHERE user_id = auth.uid() AND rol = 'admin')
  );

CREATE POLICY "configuracion_update_admin" ON configuracion
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM perfiles WHERE user_id = auth.uid() AND rol = 'admin')
  );

CREATE POLICY "configuracion_delete_admin" ON configuracion
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM perfiles WHERE user_id = auth.uid() AND rol = 'admin')
  );

-- 3. Datos iniciales por defecto
INSERT INTO configuracion (clave, valor) VALUES
  ('anonimizar_pacientes', 'true'),
  ('duracion_default_min', '30'),
  ('buffer_default_min', '30'),
  ('clinica_nombre', '"CliniAgenda"'),
  ('clinica_telefono', '""'),
  ('clinica_direccion', '""'),
  ('recordatorios_horas_antes', '24')
ON CONFLICT (clave) DO NOTHING;

-- 4. RPC: leer todas las configuraciones
CREATE OR REPLACE FUNCTION public.leer_configuracion()
RETURNS TABLE(clave text, valor jsonb)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.clave, c.valor FROM configuracion c ORDER BY c.clave;
$$;

-- 5. RPC: guardar una configuración (admin only)
CREATE OR REPLACE FUNCTION public.guardar_configuracion_admin(
  p_clave text,
  p_valor jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM perfiles WHERE user_id = auth.uid() AND rol = 'admin'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos de administrador';
  END IF;

  INSERT INTO configuracion (clave, valor, updated_at)
  VALUES (p_clave, p_valor, now())
  ON CONFLICT (clave)
  DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
END;
$$;

-- 6. RPC: guardar múltiples configuraciones de una vez
CREATE OR REPLACE FUNCTION public.guardar_configuracion_batch_admin(
  p_claves text[],
  p_valores jsonb[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  i int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM perfiles WHERE user_id = auth.uid() AND rol = 'admin'
  ) THEN
    RAISE EXCEPTION 'No tiene permisos de administrador';
  END IF;

  FOR i IN 1..array_length(p_claves, 1) LOOP
    INSERT INTO configuracion (clave, valor, updated_at)
    VALUES (p_claves[i], p_valores[i], now())
    ON CONFLICT (clave)
    DO UPDATE SET valor = EXCLUDED.valor, updated_at = now();
  END LOOP;
END;
$$;

-- 7. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
