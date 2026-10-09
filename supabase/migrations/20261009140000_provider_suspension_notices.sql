-- Pendientes · fase E (2026-10-09): el proveedor suspendido se entera (PR-02, R-20).
--
-- Suspender (F6) corta las reservas nuevas, pero el profesional o la empresa no veía nada: solo
-- notaba que no le llegaban reservas. Decisión del usuario: aviso en su panel (lo lee de
-- `gardener_profiles.suspended_at`, que ya puede leer) y correo al suspender y al reactivar; a los
-- empleados de una empresa suspendida no se les avisa (2026-10-09): sus trabajos siguen.
--
-- `admin_set_provider_suspended` apunta el aviso en la cola (F3) en la misma transacción, SOLO si el
-- estado cambia: suspender lo ya suspendido o reactivar lo activo no manda nada. La baja (F6) pone
-- `suspended_at` por su cuenta, sin pasar por aquí: no manda este correo a una cuenta que se va.
--
-- Vuelta atrás: la función de 20260929130000.

CREATE OR REPLACE FUNCTION public.admin_set_provider_suspended(p_user_id uuid, p_suspended boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_was_suspended boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede suspender cuentas.' USING ERRCODE = '42501';
  END IF;
  SELECT suspended_at IS NOT NULL INTO v_was_suspended FROM public.gardener_profiles WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa cuenta no es un profesional ni una empresa.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.gardener_profiles
  SET suspended_at = CASE WHEN p_suspended THEN COALESCE(suspended_at, now()) ELSE NULL END
  WHERE user_id = p_user_id;
  UPDATE public.companies SET status = CASE WHEN p_suspended THEN 'suspended' ELSE 'active' END, updated_at = now()
  WHERE provider_user_id = p_user_id;

  IF v_was_suspended IS DISTINCT FROM p_suspended THEN
    PERFORM private.enqueue_notification(
      CASE WHEN p_suspended THEN 'provider_suspended' ELSE 'provider_reactivated' END,
      format('provider_%s:%s:%s', CASE WHEN p_suspended THEN 'suspended' ELSE 'reactivated' END, p_user_id, txid_current()),
      NULL,
      jsonb_build_object('user_id', p_user_id));
  END IF;

  RETURN jsonb_build_object('userId', p_user_id, 'suspended', p_suspended, 'changed', v_was_suspended IS DISTINCT FROM p_suspended);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_set_provider_suspended(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_provider_suspended(uuid, boolean) TO authenticated;
