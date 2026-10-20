-- Marketing del profesional (2026-10-20): apuntar qué materiales descarga o comparte cada
-- profesional (flyer, tarjetas, vinilo…), para que el admin vea quién se promociona. Solo se
-- apunta; las imágenes se generan en el navegador y no se guardan.

CREATE TABLE IF NOT EXISTS public.marketing_downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  material text NOT NULL CHECK (material IN (
    'social', 'business_card', 'next_visit_card', 'mailbox_flyer', 'van_vinyl',
    'tear_off_poster', 'qr_stickers', 'fence_sign', 'qr_code'
  )),
  format text NOT NULL CHECK (char_length(format) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS marketing_downloads_provider_idx
  ON public.marketing_downloads (provider_id, created_at DESC);

-- Sin políticas: nadie la lee ni la escribe directamente; solo las funciones de abajo.
ALTER TABLE public.marketing_downloads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.marketing_downloads FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.marketing_downloads TO service_role;

-- La cuenta proveedora con sesión apunta lo que acaba de descargar o compartir.
CREATE OR REPLACE FUNCTION public.log_marketing_download(p_material text, p_formats text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_formats text[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_uid) THEN
    RAISE EXCEPTION 'Esta cuenta no es una cuenta profesional.' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT f) INTO v_formats
  FROM unnest(COALESCE(p_formats, '{}'::text[])) AS f
  WHERE NULLIF(BTRIM(f), '') IS NOT NULL;
  IF v_formats IS NULL OR cardinality(v_formats) = 0 OR cardinality(v_formats) > 10 THEN
    RAISE EXCEPTION 'Formatos no válidos.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.marketing_downloads (provider_id, material, format)
  SELECT v_uid, p_material, f FROM unnest(v_formats) AS f;
  RETURN cardinality(v_formats);
END;
$$;

REVOKE ALL ON FUNCTION public.log_marketing_download(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_marketing_download(text, text[]) TO authenticated, service_role;

-- El admin «Profesionales» ve además su marketing: cuántas descargas, cuáles y la última.
-- Copia de 20261020120000 con el campo `marketing` añadido.
CREATE OR REPLACE FUNCTION public.admin_provider_setup_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no es administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', gp.user_id,
      'name', gp.full_name,
      'provider_kind', gp.provider_kind,
      'email', u.email,
      'phone', NULLIF(BTRIM(COALESCE(gp.phone, '')), ''),
      'approved_at', gp.created_at,
      'status', public.provider_setup_status(gp.user_id),
      'marketing', (
        SELECT jsonb_build_object(
          'downloads', count(*),
          'last_at', max(md.created_at),
          'materials', COALESCE(jsonb_agg(DISTINCT md.material), '[]'::jsonb)
        )
        FROM public.marketing_downloads md
        WHERE md.provider_id = gp.user_id
      )
    ) ORDER BY gp.created_at DESC)
    FROM public.gardener_profiles gp
    LEFT JOIN auth.users u ON u.id = gp.user_id
    WHERE gp.user_id IS NOT NULL
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_provider_setup_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_provider_setup_overview() TO authenticated, service_role;
