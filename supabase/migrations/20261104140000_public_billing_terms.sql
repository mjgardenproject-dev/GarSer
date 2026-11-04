-- Términos de facturación PÚBLICOS: lo que la web puede decir sin mentir.
--
-- La web (landing de jardineros, FAQ, avisos del panel…) habla de quién paga gastos de gestión y quién
-- no. Antes lo decía con textos fijos y bastaba cambiar un porcentaje para que dejaran de ser ciertos.
-- Ahora el texto lo decide esta función: devuelve, por cada regla de comisión, un NIVEL cualitativo
-- derivado de la configuración vigente (commission_settings). NUNCA devuelve porcentajes ni importes:
-- la web pública no los cita y la tabla sigue siendo solo de administradores.
--
--   none      → 0 %: no se cobra nada en ese caso
--   reduced   → más de 0 % pero menos que la primera reserva de un cliente captado por GarSer
--   standard  → igual que la primera reserva de un cliente captado por GarSer
--   higher    → más que esa
--
-- Si no hay configuración, devuelve NULL y la web usa textos neutros (que no prometen nada).
-- Aditiva: no toca el motor ni las reservas.

CREATE OR REPLACE FUNCTION public.commission_term_level(p_rate numeric, p_baseline numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_rate IS NULL OR p_baseline IS NULL THEN NULL
    WHEN p_rate = 0 THEN 'none'
    WHEN p_rate < p_baseline THEN 'reduced'
    WHEN p_rate = p_baseline THEN 'standard'
    ELSE 'higher'
  END;
$$;

COMMENT ON FUNCTION public.commission_term_level(numeric, numeric) IS
  'Nivel cualitativo de un porcentaje respecto a la línea base (la primera reserva de un cliente captado por GarSer): none/reduced/standard/higher.';

CREATE OR REPLACE FUNCTION public.get_public_billing_terms()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'version', s.version,
    'garserFirst', public.commission_term_level(s.rate_garser_first, s.rate_garser_first),
    'linkFirst', public.commission_term_level(s.rate_link_first, s.rate_garser_first),
    'garserRepeat', public.commission_term_level(s.rate_garser_repeat, s.rate_garser_first),
    'linkRepeat', public.commission_term_level(s.rate_link_repeat, s.rate_garser_first),
    'maintenanceVisit', public.commission_term_level(s.rate_maintenance_visit, s.rate_garser_first)
  )
  FROM public.commission_settings s
  WHERE s.id = 1;
$$;

COMMENT ON FUNCTION public.get_public_billing_terms() IS
  'Lo que la web pública puede afirmar sobre los gastos de gestión, por regla y en niveles (none/reduced/standard/higher). Sin porcentajes. NULL si no hay configuración.';

REVOKE ALL ON FUNCTION public.commission_term_level(numeric, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_public_billing_terms() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_billing_terms() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commission_term_level(numeric, numeric) TO service_role;
