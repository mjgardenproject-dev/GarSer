-- Crear tabla de logs de roles
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

-- Habilitar RLS
ALTER TABLE role_logs ENABLE ROW LEVEL SECURITY;

-- Políticas para role_logs
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

-- Crear índice para mejorar el rendimiento
CREATE INDEX IF NOT EXISTS idx_role_logs_user_id ON role_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_role_logs_created_at ON role_logs(created_at);