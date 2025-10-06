-- Migración para el sistema de reservas mejorado con bloques horarios
-- Fecha: 2025-01-01

-- Crear tabla de bloques de disponibilidad (reemplaza la tabla availability existente)
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

-- Crear tabla de solicitudes de reserva (para distribución a múltiples jardineros)
CREATE TABLE IF NOT EXISTS booking_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_hour integer NOT NULL, -- Hora de inicio (0-23)
  duration_hours integer NOT NULL,
  client_address text NOT NULL,
  notes text,
  status text CHECK (status IN ('pending', 'accepted', 'rejected', 'expired')) DEFAULT 'pending',
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- Jardinero que aceptó
  expires_at timestamptz DEFAULT (now() + interval '24 hours'), -- Expira en 24 horas
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Crear tabla de respuestas de jardineros a solicitudes
CREATE TABLE IF NOT EXISTS booking_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES booking_requests(id) ON DELETE CASCADE,
  gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  response_type text CHECK (response_type IN ('accept', 'reject', 'suggest_alternative')) NOT NULL,
  suggested_date date, -- Solo para suggest_alternative
  suggested_start_hour integer, -- Solo para suggest_alternative
  message text, -- Mensaje opcional del jardinero
  created_at timestamptz DEFAULT now(),
  UNIQUE(request_id, gardener_id)
);

-- Crear tabla de bloques de reserva (para manejar múltiples bloques por reserva)
CREATE TABLE IF NOT EXISTS booking_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  date date NOT NULL,
  hour_block integer NOT NULL, -- 0-23
  created_at timestamptz DEFAULT now(),
  UNIQUE(booking_id, date, hour_block)
);

-- Crear tabla de conversaciones de sugerencias
CREATE TABLE IF NOT EXISTS suggestion_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES booking_requests(id) ON DELETE CASCADE,
  gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  status text CHECK (status IN ('active', 'accepted', 'rejected', 'closed')) DEFAULT 'active',
  suggested_date date,
  suggested_start_hour integer,
  suggested_duration_hours integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Crear tabla de mensajes de chat para sugerencias
CREATE TABLE IF NOT EXISTS suggestion_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid REFERENCES suggestion_chats(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  message_type text CHECK (message_type IN ('text', 'suggestion', 'acceptance', 'rejection')) DEFAULT 'text',
  created_at timestamptz DEFAULT now()
);

-- Agregar columnas a la tabla bookings existente para el nuevo sistema
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES booking_requests(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS end_time time, -- Calculado automáticamente
ADD COLUMN IF NOT EXISTS buffer_applied boolean DEFAULT false; -- Si se aplicó buffer de 30 min

-- Crear índices para optimizar consultas
CREATE INDEX IF NOT EXISTS idx_availability_blocks_gardener_date ON availability_blocks(gardener_id, date);
CREATE INDEX IF NOT EXISTS idx_availability_blocks_date_hour ON availability_blocks(date, hour_block);
CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);
CREATE INDEX IF NOT EXISTS idx_booking_requests_expires ON booking_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_booking_blocks_booking ON booking_blocks(booking_id);
CREATE INDEX IF NOT EXISTS idx_suggestion_chats_request ON suggestion_chats(request_id);

-- Función para calcular end_time automáticamente
CREATE OR REPLACE FUNCTION calculate_end_time()
RETURNS TRIGGER AS $$
BEGIN
  NEW.end_time = (NEW.start_time::time + (NEW.duration_hours || ' hours')::interval)::time;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para calcular end_time automáticamente
DROP TRIGGER IF EXISTS trigger_calculate_end_time ON bookings;
CREATE TRIGGER trigger_calculate_end_time
  BEFORE INSERT OR UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION calculate_end_time();

-- Función para limpiar solicitudes expiradas
CREATE OR REPLACE FUNCTION cleanup_expired_requests()
RETURNS void AS $$
BEGIN
  UPDATE booking_requests 
  SET status = 'expired' 
  WHERE status = 'pending' 
  AND expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- Políticas RLS para las nuevas tablas
ALTER TABLE availability_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestion_messages ENABLE ROW LEVEL SECURITY;

-- Políticas para availability_blocks
CREATE POLICY "Jardineros pueden gestionar su disponibilidad" ON availability_blocks
  FOR ALL USING (auth.uid() = gardener_id);

CREATE POLICY "Clientes pueden ver disponibilidad" ON availability_blocks
  FOR SELECT USING (is_available = true);

-- Políticas para booking_requests
CREATE POLICY "Clientes pueden gestionar sus solicitudes" ON booking_requests
  FOR ALL USING (auth.uid() = client_id);

CREATE POLICY "Jardineros pueden ver solicitudes en su área" ON booking_requests
  FOR SELECT USING (
    status = 'pending' AND 
    EXISTS (
      SELECT 1 FROM gardener_profiles gp 
      WHERE gp.user_id = auth.uid() 
      AND gp.is_available = true
    )
  );

-- Políticas para booking_responses
CREATE POLICY "Jardineros pueden gestionar sus respuestas" ON booking_responses
  FOR ALL USING (auth.uid() = gardener_id);

CREATE POLICY "Clientes pueden ver respuestas a sus solicitudes" ON booking_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM booking_requests br 
      WHERE br.id = request_id 
      AND br.client_id = auth.uid()
    )
  );

-- Políticas para booking_blocks
CREATE POLICY "Usuarios pueden ver bloques de sus reservas" ON booking_blocks
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM bookings b 
      WHERE b.id = booking_id 
      AND (b.client_id = auth.uid() OR b.gardener_id = auth.uid())
    )
  );

-- Políticas para suggestion_chats
CREATE POLICY "Participantes pueden gestionar chats de sugerencias" ON suggestion_chats
  FOR ALL USING (auth.uid() = client_id OR auth.uid() = gardener_id);

-- Políticas para suggestion_messages
CREATE POLICY "Participantes pueden gestionar mensajes" ON suggestion_messages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM suggestion_chats sc 
      WHERE sc.id = chat_id 
      AND (sc.client_id = auth.uid() OR sc.gardener_id = auth.uid())
    )
  );