/*
  # Esquema inicial para aplicación de jardinería

  1. Nuevas tablas
    - `profiles` - Perfiles de usuario básicos
    - `services` - Catálogo de servicios disponibles
    - `gardener_profiles` - Perfiles extendidos para jardineros
    - `availability` - Disponibilidad de jardineros
    - `bookings` - Reservas de servicios
    - `reviews` - Reseñas y calificaciones
    - `chat_messages` - Mensajes del chat

  2. Seguridad
    - Habilitar RLS en todas las tablas
    - Políticas de acceso basadas en roles y autenticación
*/

-- Crear tabla de perfiles básicos
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text DEFAULT '',
  phone text DEFAULT '',
  address text DEFAULT '',
  avatar_url text,
  role text CHECK (role IN ('client', 'gardener')) DEFAULT 'client',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Crear tabla de servicios
CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL,
  base_price decimal(10,2) NOT NULL,
  icon text DEFAULT 'leaf',
  image_id text,
  created_at timestamptz DEFAULT now()
);

-- Crear tabla de perfiles de jardineros
CREATE TABLE IF NOT EXISTS gardener_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text NOT NULL,
  address text NOT NULL,
  avatar_url text,
  services text[] DEFAULT '{}',
  max_distance integer DEFAULT 25,
  rating decimal(3,2) DEFAULT 5.0,
  total_reviews integer DEFAULT 0,
  description text DEFAULT '',
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Crear tabla de disponibilidad
CREATE TABLE IF NOT EXISTS availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Crear tabla de reservas
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  date date NOT NULL,
  start_time time NOT NULL,
  duration_hours integer NOT NULL,
  status text CHECK (status IN ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled')) DEFAULT 'pending',
  total_price decimal(10,2) NOT NULL,
  travel_fee decimal(10,2) DEFAULT 15.00,
  hourly_rate decimal(10,2) DEFAULT 25.00,
  client_address text NOT NULL,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Crear tabla de reseñas
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  client_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  rating integer CHECK (rating >= 1 AND rating <= 5) NOT NULL,
  comment text,
  created_at timestamptz DEFAULT now()
);

-- Crear tabla de mensajes de chat
CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Insertar servicios iniciales
INSERT INTO services (name, description, base_price, image_id) VALUES
('Corte de césped', 'Mantenimiento regular para un césped sano y uniforme. Incluye corte, perfilado de bordes y limpieza de residuos.', 30.00, '416978'),
('Arreglo general del jardín', 'Labores de labranza, poda básica y puesta a punto de las zonas verdes. Servicio integral de mantenimiento.', 45.00, '1301856'),
('Poda de árboles y arbustos', 'Poda profesional para favorecer el crecimiento y mantener la estética del jardín. Incluye limpieza de ramas.', 40.00, '1301856'),
('Recorte de setos', 'Diseño y mantenimiento de setos con un acabado limpio y cuidado. Formas geométricas y naturales.', 35.00, '1301856'),
('Fumigación y control de plagas', 'Tratamientos específicos para proteger plantas y césped. El coste de los productos no está incluido.', 50.00, '416978'),
('Plantación de nuevas especies', 'Incorporación y añadido de plantas al gusto del cliente. El coste de las plantas no está incluido.', 40.00, '1301856'),
('Instalación de sistemas de riego automático', 'Optimización del consumo de agua y comodidad en el riego. El coste del material no está incluido.', 80.00, '416978'),
('Fertilización y abonado', 'Aplicación de nutrientes para mejorar la salud y desarrollo de las plantas. El coste de productos no está incluido.', 35.00, '1301856');

-- Habilitar RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE gardener_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
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

-- Políticas para services
CREATE POLICY "Anyone can read services"
  ON services
  FOR SELECT
  TO authenticated
  USING (true);

-- Políticas para gardener_profiles
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

-- Políticas para availability
CREATE POLICY "Anyone can read availability"
  ON availability
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Gardeners can manage own availability"
  ON availability
  FOR ALL
  TO authenticated
  USING (auth.uid() = gardener_id);

-- Políticas para bookings
CREATE POLICY "Users can read own bookings"
  ON bookings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = client_id OR auth.uid() = gardener_id);

CREATE POLICY "Clients can create bookings"
  ON bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = client_id);

CREATE POLICY "Participants can update bookings"
  ON bookings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = client_id OR auth.uid() = gardener_id);

-- Políticas para reviews
CREATE POLICY "Anyone can read reviews"
  ON reviews
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Clients can create reviews"
  ON reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = client_id);

-- Políticas para chat_messages
CREATE POLICY "Booking participants can read messages"
  ON chat_messages
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings 
      WHERE bookings.id = booking_id 
      AND (bookings.client_id = auth.uid() OR bookings.gardener_id = auth.uid())
    )
  );

CREATE POLICY "Booking participants can send messages"
  ON chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (
      SELECT 1 FROM bookings 
      WHERE bookings.id = booking_id 
      AND (bookings.client_id = auth.uid() OR bookings.gardener_id = auth.uid())
    )
  );
