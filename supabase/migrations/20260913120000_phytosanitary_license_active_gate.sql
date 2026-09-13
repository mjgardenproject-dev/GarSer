-- T1 (transversal) + decisiones D1/D2/D3 del usuario (2026-09-13):
--
-- D1 · Una licencia está ACTIVA cuando: el jardinero mandó la foto, el admin la aprobó, Y
--      la fecha de caducidad (que el admin escribe ANTES de aprobar) no ha pasado. Al
--      caducar, la licencia deja de estar activa y el jardinero tiene que volver a subir el
--      documento y ser aprobado de nuevo — no hay renovación automática.
-- D2 · Palmeras se queda FUERA de esta puerta (su extra fitosanitario, p.ej. Picudo Rojo,
--      no se toca en esta ronda).
-- D3 · Además de filtrar la búsqueda del cliente (eso vive en booking-authority /
--      bookingEligibilityCore.ts), el jardinero se bloquea en su propio configurador.
--
-- Qué trae esta migración:
--   1) 'expired' como estado válido, en las dos tablas que ya tenían las columnas de
--      licencia (`gardener_licenses.status`, `gardener_profiles.license_verification_status`)
--      — los dos campos de caducidad (`expires_at` / `license_expires_at`) YA EXISTÍAN desde
--      20260408000000, pero nadie los rellenaba ni los leía en ningún sitio.
--   2) `review_gardener_license()`: sustituye a los DOS `.update()` sueltos que hacía
--      `LicenseVerificationAdmin.tsx` desde el navegador (uno en `gardener_licenses`, otro en
--      `gardener_profiles`, sin transacción entre ambos — si el segundo fallaba, la licencia
--      quedaba aprobada en una tabla y sin reflejar en la otra). Exige la fecha de caducidad
--      para aprobar: es la puerta técnica de "el admin la escribe antes de aprobarla".
--   3) `expire_due_phytosanitary_licenses()`: la usa el reloj (`booking-lifecycle-tick`,
--      job 5) para pasar a 'expired' las licencias aprobadas cuya fecha ya pasó.

ALTER TABLE public.gardener_licenses DROP CONSTRAINT IF EXISTS gardener_licenses_status_check;
ALTER TABLE public.gardener_licenses ADD CONSTRAINT gardener_licenses_status_check
  CHECK (status = ANY (ARRAY['pending', 'approved', 'rejected', 'replaced', 'expired']));

ALTER TABLE public.gardener_profiles DROP CONSTRAINT IF EXISTS gardener_profiles_license_verification_status_check;
ALTER TABLE public.gardener_profiles ADD CONSTRAINT gardener_profiles_license_verification_status_check
  CHECK (license_verification_status = ANY (ARRAY['pending', 'approved', 'rejected', 'expired']));

-- =============================================
-- Aprobar/rechazar una licencia (admin)
-- =============================================
CREATE OR REPLACE FUNCTION public.review_gardener_license(
  p_license_id uuid,
  p_status text,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license public.gardener_licenses%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar licencias' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Desenlace no válido: % (solo approved o rejected)', p_status
      USING ERRCODE = '22023';
  END IF;

  -- D1: la caducidad la escribe el admin ANTES de aprobar, no después. Sin fecha (o con una
  -- fecha ya pasada) no se puede aprobar — sería aprobar una licencia caducada el mismo día.
  IF p_status = 'approved' AND (p_expires_at IS NULL OR p_expires_at <= now()) THEN
    RAISE EXCEPTION 'Para aprobar hace falta una fecha de caducidad futura' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_license FROM public.gardener_licenses WHERE id = p_license_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licencia no encontrada' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.gardener_licenses
  SET status = p_status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      expires_at = CASE WHEN p_status = 'approved' THEN p_expires_at ELSE NULL END
  WHERE id = p_license_id;

  -- Las dos tablas se actualizan en la MISMA transacción de la función: si algo falla aquí,
  -- no queda una aprobada en una tabla y pendiente en la otra (el fallo real del código
  -- anterior, que hacía dos UPDATE sueltos desde el navegador).
  UPDATE public.gardener_profiles
  SET has_phytosanitary_license = (p_status = 'approved'),
      license_verification_status = p_status,
      license_verified_at = CASE WHEN p_status = 'approved' THEN now() ELSE NULL END,
      license_expires_at = CASE WHEN p_status = 'approved' THEN p_expires_at ELSE NULL END
  WHERE user_id = v_license.gardener_id;

  RETURN jsonb_build_object(
    'licenseId', p_license_id,
    'gardenerId', v_license.gardener_id,
    'status', p_status,
    'expiresAt', p_expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_gardener_license(uuid, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_gardener_license(uuid, text, timestamptz) TO authenticated;

-- =============================================
-- Caducidad automática (la dispara el reloj)
-- =============================================
CREATE OR REPLACE FUNCTION public.expire_due_phytosanitary_licenses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gardener_ids uuid[];
  v_count integer := 0;
BEGIN
  SELECT COALESCE(array_agg(gardener_id), '{}'::uuid[])
  INTO v_gardener_ids
  FROM public.gardener_licenses
  WHERE status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  v_count := COALESCE(array_length(v_gardener_ids, 1), 0);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  UPDATE public.gardener_licenses
  SET status = 'expired'
  WHERE gardener_id = ANY(v_gardener_ids)
    AND status = 'approved'
    AND expires_at IS NOT NULL
    AND expires_at <= now();

  UPDATE public.gardener_profiles
  SET has_phytosanitary_license = false,
      license_verification_status = 'expired'
  WHERE user_id = ANY(v_gardener_ids);

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_due_phytosanitary_licenses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_phytosanitary_licenses() TO service_role;
