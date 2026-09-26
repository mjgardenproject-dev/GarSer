-- GarSer Empresas · H-39 / D21 (2026-09-26): el empleado invitado crea su contraseña en la propia
-- invitación y entra directo a su panel.
--
-- Hasta ahora aceptar una invitación exigía una sesión (accept_company_invitation con auth.uid()):
-- el invitado tenía que registrarse como cliente, confirmar el correo con otro mensaje y volver al
-- enlace en el mismo navegador. En producción casi nunca llegaba a su panel.
--
-- Ahora la Edge Function `company-invitation-signup` crea la cuenta ya confirmada (el token de la
-- invitación, de 256 bits, de un solo uso y atado al correo, prueba que se leyó ese buzón) y la
-- une al equipo con la función de servicio de abajo. Las reglas son LAS MISMAS en los dos
-- caminos: por eso el cuerpo pasa a private.accept_company_invitation_for(usuario, token).

CREATE OR REPLACE FUNCTION private.accept_company_invitation_for(p_user_id uuid, p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invitations%ROWTYPE;
  v_email text;
  v_company_name text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Inicia sesión para aceptar la invitación.';
  END IF;

  SELECT * INTO v_inv FROM public.company_invitations
  WHERE token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esta invitación no es válida.';
  END IF;
  IF v_inv.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación se ha anulado. Pide a la empresa que te envíe otra.';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta invitación ya se ha usado.';
  END IF;
  IF v_inv.expires_at <= now() THEN
    RAISE EXCEPTION 'Esta invitación ha caducado. Pide a la empresa que te envíe otra.';
  END IF;
  IF (SELECT status FROM public.companies WHERE id = v_inv.company_id) <> 'active' THEN
    RAISE EXCEPTION 'La empresa que te invita no está activa.';
  END IF;

  SELECT lower(email) INTO v_email FROM auth.users WHERE id = p_user_id;
  IF v_email IS DISTINCT FROM v_inv.email THEN
    RAISE EXCEPTION 'Esta invitación es para otro correo. Entra con la cuenta de %.', v_inv.email;
  END IF;
  IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION 'Tu cuenta es de profesional en GarSer. Para trabajar como empleado de una empresa necesitas una cuenta distinta.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_members WHERE user_id = p_user_id AND status = 'active') THEN
    RAISE EXCEPTION 'Ya formas parte de una empresa en GarSer.';
  END IF;
  IF (SELECT role FROM public.profiles WHERE user_id = p_user_id) IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'Solo una cuenta de cliente puede unirse a una empresa como empleado.';
  END IF;

  -- Quien estuvo antes en esta empresa y se fue, se reactiva (se conserva su histórico).
  UPDATE public.company_members
  SET status = 'active', role = 'employee', left_at = NULL, joined_at = now(), counts_as_labour = true
  WHERE company_id = v_inv.company_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_inv.company_id, p_user_id, 'employee');
  END IF;

  PERFORM private.set_account_role_trusted(p_user_id, 'employee');

  UPDATE public.company_invitations SET accepted_at = now(), accepted_by = p_user_id WHERE id = v_inv.id;

  SELECT gp.full_name INTO v_company_name
  FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
  WHERE c.id = v_inv.company_id;

  RETURN jsonb_build_object('company_id', v_inv.company_id, 'company_name', v_company_name);
END;
$$;

REVOKE ALL ON FUNCTION private.accept_company_invitation_for(uuid, text) FROM PUBLIC, anon, authenticated;

-- Quien ya tiene cuenta y sesión: igual que siempre.
CREATE OR REPLACE FUNCTION public.accept_company_invitation(p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.accept_company_invitation_for(auth.uid(), p_token);
$$;

REVOKE ALL ON FUNCTION public.accept_company_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation(text) TO authenticated;

-- Solo la Edge Function company-invitation-signup (clave de servicio), justo después de crear la
-- cuenta del invitado con el correo de la invitación.
CREATE OR REPLACE FUNCTION public.accept_company_invitation_as_service(p_user_id uuid, p_token text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.accept_company_invitation_for(p_user_id, p_token);
$$;

REVOKE ALL ON FUNCTION public.accept_company_invitation_as_service(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_company_invitation_as_service(uuid, text) TO service_role;

COMMENT ON FUNCTION public.accept_company_invitation_as_service(uuid, text) IS
  'GarSer Empresas (D21): une al equipo la cuenta que company-invitation-signup acaba de crear para el correo invitado. Solo service_role; mismas reglas que accept_company_invitation.';
