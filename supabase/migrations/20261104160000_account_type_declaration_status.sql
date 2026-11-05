-- Tipo de cuenta al entrar con Google, versión robusta (2026-11-04).
--
-- Antes (20261028120000) self_declare_signup_role devolvía void y se callaba en tres casos
-- distintos: la cuenta ya no era 'client', ya era del tipo pedido, o no se podía. El front no
-- distinguía «hecho» de «no se pudo» y la persona acababa como cliente sin enterarse. Además, el
-- front solo la llamaba si la cuenta parecía «nueva» según el reloj del móvil.
--
-- Ahora la función decide ella sola (con el reloj y los datos del servidor) y devuelve un estado
-- que el front enseña tal cual:
--   'declared'         cuenta de cliente SIN actividad → pasa a gardener/company.
--   'unchanged'        ya era de ese tipo (reintento, doble clic): nada que hacer.
--   'blocked_role'     ya es de OTRO tipo (jardinero, empresa, empleado, admin): no se toca.
--   'blocked_activity' cliente con reservas, solicitudes o relación con un profesional: no se
--                      cambia por su cuenta (sus datos de cliente se quedarían colgando).
--   'no_profile'       no hay perfil (no debería pasar: lo crea el trigger del alta).
--
-- Sigue siendo self-service y solo gardener/company (nunca admin ni employee), con el mismo camino
-- de confianza que las RPC de aprobación (private.set_account_role_trusted). Ser 'gardener' o
-- 'company' no publica a nadie: el administrador revisa la solicitud antes de que aparezca.
--
-- Cambia el tipo de retorno (void → text): hay que borrarla y crearla de nuevo. El front desplegado
-- hoy solo mira `error`, así que sigue funcionando con la nueva (el orden de despliegue da igual).
DROP FUNCTION IF EXISTS public.self_declare_signup_role(text);

CREATE FUNCTION public.self_declare_signup_role(p_role text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_current text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sin sesión.';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('gardener', 'company') THEN
    RAISE EXCEPTION 'Rol no permitido.';
  END IF;

  SELECT role INTO v_current FROM public.profiles WHERE user_id = v_uid;

  IF v_current IS NULL THEN
    RETURN 'no_profile';
  END IF;
  IF v_current = p_role THEN
    RETURN 'unchanged';
  END IF;
  IF v_current <> 'client' THEN
    RETURN 'blocked_role';
  END IF;

  IF EXISTS (SELECT 1 FROM public.bookings WHERE client_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.booking_requests WHERE client_id = v_uid)
     OR EXISTS (SELECT 1 FROM public.client_provider_relationships WHERE client_id = v_uid) THEN
    RETURN 'blocked_activity';
  END IF;

  PERFORM private.set_account_role_trusted(v_uid, p_role);
  RETURN 'declared';
END;
$$;

REVOKE ALL ON FUNCTION public.self_declare_signup_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_declare_signup_role(text) TO authenticated;
