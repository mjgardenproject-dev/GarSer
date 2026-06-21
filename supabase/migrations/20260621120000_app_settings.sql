-- App settings: configuración global del negocio editable desde el panel de admin.
--
-- Tabla singleton (una sola fila, id = 1) con los datos de contacto/marca que hoy
-- estaban hardcodeados en `src/config/publicSiteContent.ts` (PUBLIC_CONTACT_EMAIL = '').
--
-- IMPORTANTE: aquí NO se guardan tasas de pricing (IVA, comisión, desplazamiento).
-- Esas viven en `src/shared/bookingQuoteCore.ts` y las consume tanto el frontend
-- como el edge function `booking-authority`; hacerlas editables exige sincronizar
-- ambos lados y se aborda en un PR dedicado para no arriesgar los cobros reales.
--
-- Seguridad (RLS):
--   - SELECT: público (anon + authenticated). Son datos que ya se muestran en el
--     footer público y en los datos estructurados SEO.
--   - INSERT/UPDATE: solo administradores vía public.is_admin().

CREATE TABLE IF NOT EXISTS public.app_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  business_name text NOT NULL DEFAULT 'GarSer',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Garantiza que siempre exista la fila singleton.
INSERT INTO public.app_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Lectura pública: el footer y el SEO necesitan estos datos sin sesión.
DROP POLICY IF EXISTS "app_settings_public_read" ON public.app_settings;
CREATE POLICY "app_settings_public_read"
  ON public.app_settings FOR SELECT
  TO anon, authenticated
  USING (true);

-- Escritura solo admin.
DROP POLICY IF EXISTS "app_settings_admin_write" ON public.app_settings;
CREATE POLICY "app_settings_admin_write"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
