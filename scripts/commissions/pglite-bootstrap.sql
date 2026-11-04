-- Esquema mínimo para ejecutar las migraciones de comisiones SIN Docker (PGlite).
--
-- No es el esquema de producción: son las tablas y columnas que tocan las migraciones de la serie
-- 20261102* y las anteriores que ellas modifican (20260803120000 y 20261019120000, que se ejecutan
-- tal cual). Lo que no se usa no está.
--
-- Lo monta scripts/commissions/pglite-sql-tests.mjs. Nada de esto va a producción.

DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz,
  raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  confirmation_token text, recovery_token text, email_change text, email_change_token_new text,
  email_change_token_current text, phone_change text, phone_change_token text, reauthentication_token text
);

-- Igual que la de Supabase: lee el sub del JWT de la petición.
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.sub', true), ''),
    (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE TABLE public.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'client',
  full_name text
);

-- El perfil lo crea un trigger al dar de alta el usuario (en Supabase: el de signup).
CREATE FUNCTION public.stub_profile_on_signup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.profiles (user_id, role, full_name) VALUES (NEW.id, 'client', NEW.email);
  RETURN NEW;
END $$;
CREATE TRIGGER stub_profile_on_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.stub_profile_on_signup();

-- Definición real (20260609184643_admin_full_access_rls.sql).
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles
    WHERE user_id = auth.uid()
    AND role = 'admin'
  );
$$;

CREATE TABLE public.app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name text NOT NULL DEFAULT 'GarSer',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
INSERT INTO public.app_settings (id) VALUES (1);

CREATE TABLE public.services (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
INSERT INTO public.services (name) VALUES ('Corte de césped');

CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid REFERENCES auth.users(id),
  gardener_id uuid REFERENCES auth.users(id),
  service_id uuid,
  date date NOT NULL,
  start_time time NOT NULL,
  duration_hours integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  total_price numeric(10,2) NOT NULL,
  client_address text NOT NULL DEFAULT 'x',
  pricing_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  maintenance_plan_id uuid
);

CREATE TABLE public.booking_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid, gardener_id uuid, service_id uuid,
  signature text UNIQUE,
  pricing_version text, provider_config_version text,
  input_payload jsonb DEFAULT '{}'::jsonb, pricing_snapshot jsonb DEFAULT '{}'::jsonb,
  total_price numeric, estimated_hours numeric,
  status text, generated_at timestamptz DEFAULT now(), expires_at timestamptz,
  selected_date date, selected_start_time time,
  availability_snapshot jsonb, economic_snapshot jsonb, items jsonb,
  client_latitude numeric, client_longitude numeric, provider_latitude numeric, provider_longitude numeric,
  maintenance_visit_id uuid, booking_id uuid
);

CREATE TABLE public.booking_payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid, quote_id uuid, client_id uuid, gardener_id uuid, service_id uuid,
  quote_signature text, selected_date date, selected_start_time time, duration_hours integer,
  status text NOT NULL DEFAULT 'created',
  service_total_amount_cents integer,
  payable_now_amount_cents integer NOT NULL CHECK (payable_now_amount_cents > 0),
  economic_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  currency text DEFAULT 'eur',
  stripe_idempotency_key text,
  confirmed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.maintenance_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_booking_id uuid, source_quote_id uuid,
  frequency text NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly')),
  start_hour integer NOT NULL, anchor_date date NOT NULL, next_visit_date date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled')),
  service_id uuid NOT NULL,
  input_payload jsonb NOT NULL DEFAULT '{}'::jsonb, items jsonb,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb, economic_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_price numeric NOT NULL CHECK (total_price > 0), estimated_hours numeric NOT NULL CHECK (estimated_hours > 0),
  pricing_version text NOT NULL, provider_config_version text NOT NULL,
  client_latitude numeric(9,6), client_longitude numeric(9,6), provider_latitude numeric(9,6), provider_longitude numeric(9,6),
  created_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz, cancelled_by uuid
);

CREATE TABLE public.maintenance_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.maintenance_plans(id) ON DELETE CASCADE,
  planned_date date NOT NULL, date date, start_hour integer,
  quote_id uuid, booking_id uuid,
  status text NOT NULL CHECK (status IN ('proposed', 'booked', 'skipped', 'no_availability', 'cancelled')),
  notified_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plan_id, planned_date)
);

-- Definición real (20260926140000_empresas_f9_maintenance_plans.sql).
CREATE OR REPLACE FUNCTION public.maintenance_next_date(p_date date, p_frequency text)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_frequency
    WHEN 'weekly' THEN p_date + 7
    WHEN 'biweekly' THEN p_date + 14
    ELSE (p_date + interval '1 month')::date
  END;
$$;

-- El planificador real es enorme; para estas pruebas basta un hueco fijo dentro de la ventana.
CREATE OR REPLACE FUNCTION public.maintenance_find_slot(p_plan_id uuid, p_date date)
RETURNS TABLE(slot_date date, slot_hour integer, first_day_hours integer, end_date date)
LANGUAGE sql STABLE AS $$ SELECT p_date, 10, 2, NULL::date $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
