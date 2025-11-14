-- Migración para corregir problemas de base de datos
-- Fecha: 2025-10-02
-- Corrige errores 404 y 406 en availability_blocks, profiles y role_logs

-- 1. Asegurar que la tabla availability_blocks existe y tiene las políticas correctas
CREATE TABLE IF NOT EXISTS availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  hour_block integer NOT NULL, -- 0-23 representando las horas del día
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(gardener_id, date, hour_block)
);

-- 2. Habilitar RLS en availability_blocks si no está habilitado
ALTER TABLE availability_blocks ENABLE ROW LEVEL SECURITY;

-- 3. Eliminar políticas existentes para recrearlas correctamente
DROP POLICY IF EXISTS "Jardineros pueden gestionar su disponibilidad" ON availability_blocks;
DROP POLICY IF EXISTS "Clientes pueden ver disponibilidad" ON availability_blocks;
DROP POLICY IF EXISTS "Anyone can read availability" ON availability_blocks;
DROP POLICY IF EXISTS "Gardeners can manage own availability" ON availability_blocks;

-- 4. Crear políticas correctas para availability_blocks
CREATE POLICY "Gardeners can manage own availability blocks"
  ON availability_blocks
  FOR ALL
  TO authenticated
  USING (auth.uid() = gardener_id);

CREATE POLICY "Anyone can read availability blocks"
  ON availability_blocks
  FOR SELECT
  TO authenticated
  USING (true);

-- 5. Corregir políticas de profiles si hay problemas
DROP POLICY IF EXISTS "Users can read own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;

-- Recrear políticas de profiles
CREATE POLICY "Users can read own profile"
  ON profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
  ON profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile"
  ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 6. Asegurar que gardener_profiles tiene políticas correctas
DROP POLICY IF EXISTS "Anyone can read gardener profiles" ON gardener_profiles;
DROP POLICY IF EXISTS "Gardeners can manage own profile" ON gardener_profiles;

CREATE POLICY "Anyone can read gardener profiles"
  ON gardener_profiles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Gardeners can manage own profile"
  ON gardener_profiles
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id);

-- 7. Asegurar que role_logs existe y tiene políticas correctas
CREATE TABLE IF NOT EXISTS role_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  old_role text,
  new_role text,
  details text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Habilitar RLS en role_logs
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;

-- Eliminar políticas existentes de role_logs
DROP POLICY IF EXISTS "Users can read own role logs" ON role_logs;
DROP POLICY IF EXISTS "Users can insert own role logs" ON role_logs;

-- Recrear políticas de role_logs
CREATE POLICY "Users can read own role logs"
  ON role_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own role logs"
  ON role_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- 8. Crear índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_availability_blocks_gardener_date ON availability_blocks(gardener_id, date);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_date_hour ON availability_blocks(date, hour_block);
CREATE INDEX IF NOT EXISTS idx_role_logs_user_id ON role_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_role_logs_created_at ON role_logs(created_at);

-- 9. Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 10. Trigger para availability_blocks
DROP TRIGGER IF EXISTS update_availability_blocks_updated_at ON availability_blocks;
CREATE TRIGGER update_availability_blocks_updated_at
  BEFORE UPDATE ON availability_blocks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();