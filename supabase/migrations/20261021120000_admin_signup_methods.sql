-- Continuar con Google (2026-10-21): cuántas cuentas nuevas se crean con Google y cuántas con
-- correo, para ver si sube la conversión. Solo el admin. El método es el de la primera forma de
-- entrar de cada cuenta (auth.identities); las cuentas dadas de baja (correo @garser.invalid) no
-- cuentan.

CREATE OR REPLACE FUNCTION public.admin_signup_methods(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := LEAST(GREATEST(COALESCE(p_days, 30), 1), 365);
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no es administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN (
    WITH recent AS (
      SELECT COALESCE((
        SELECT i.provider FROM auth.identities i
        WHERE i.user_id = u.id
        ORDER BY i.created_at
        LIMIT 1
      ), 'email') AS provider
      FROM auth.users u
      WHERE u.created_at > now() - make_interval(days => v_days)
        AND COALESCE(u.email, '') NOT LIKE '%@garser.invalid'
    )
    SELECT jsonb_build_object(
      'days', v_days,
      'total', count(*),
      'google', count(*) FILTER (WHERE provider = 'google'),
      'email', count(*) FILTER (WHERE provider = 'email'),
      'other', count(*) FILTER (WHERE provider NOT IN ('google', 'email'))
    )
    FROM recent
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_signup_methods(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_signup_methods(integer) TO authenticated, service_role;
