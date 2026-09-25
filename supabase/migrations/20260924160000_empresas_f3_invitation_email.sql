-- GarSer Empresas · F3.4: correo de invitación sin convertir GarSer en un buzón de spam.
--
-- El correo de invitación lo envía send-email-notification con la marca GarSer a un correo que
-- escribe la empresa. Para que eso no sirva para mandar correos masivos:
-- 1) Tope de invitaciones por empresa: 20 cada 24 horas (una empresa de jardinería no contrata
--    a más gente en un día; si alguna lo necesita, se sube el número).
-- 2) Cada invitación se envía por correo UNA vez (email_sent_at). Reenviar = invitar de nuevo,
--    que anula la anterior y cuenta para el tope.
-- 3) mark_company_invitation_emailed(): la usa la edge function con la clave de servicio para
--    marcar el envío de forma atómica; nadie más puede llamarla.

ALTER TABLE public.company_invitations ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.create_company_invitation(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_email text := lower(BTRIM(COALESCE(p_email, '')));
  v_token text;
  v_invitation_id uuid;
  v_expires_at timestamptz := now() + interval '7 days';
BEGIN
  IF v_company_id IS NULL OR NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede invitar.';
  END IF;
  IF (SELECT status FROM public.companies WHERE id = v_company_id) <> 'active' THEN
    RAISE EXCEPTION 'La empresa no está activa.';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'El correo no es válido.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
    WHERE m.company_id = v_company_id AND m.status = 'active' AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'Esa persona ya forma parte de tu equipo.';
  END IF;
  IF (
    SELECT count(*) FROM public.company_invitations
    WHERE company_id = v_company_id AND created_at > now() - interval '24 hours'
  ) >= 20 THEN
    RAISE EXCEPTION 'Has enviado muchas invitaciones hoy. Espera a mañana o escríbenos si necesitas invitar a más personas.';
  END IF;

  -- Una invitación nueva al mismo correo anula las anteriores pendientes.
  UPDATE public.company_invitations
  SET revoked_at = now()
  WHERE company_id = v_company_id AND email = v_email AND accepted_at IS NULL AND revoked_at IS NULL;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  INSERT INTO public.company_invitations (company_id, email, token_hash, expires_at, created_by)
  VALUES (v_company_id, v_email, encode(extensions.digest(v_token, 'sha256'), 'hex'), v_expires_at, auth.uid())
  RETURNING id INTO v_invitation_id;

  -- El token solo existe aquí y en el email: no se puede recuperar después.
  RETURN jsonb_build_object('invitation_id', v_invitation_id, 'token', v_token, 'email', v_email, 'expires_at', v_expires_at);
END;
$$;

-- Marca el envío del correo de una invitación, una sola vez. Devuelve los datos para
-- componerlo, o NULL si no se debe enviar (no existe, no es de quien lo pide, el token no
-- coincide, ya no está viva o ya se envió). La llama la edge function con la clave de servicio,
-- pasando quién es el usuario que lo pide: por eso no se abre a authenticated.
CREATE OR REPLACE FUNCTION public.mark_company_invitation_emailed(p_invitation_id uuid, p_token text, p_caller uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv public.company_invitations%ROWTYPE;
  v_company_name text;
BEGIN
  UPDATE public.company_invitations i
  SET email_sent_at = now()
  WHERE i.id = p_invitation_id
    AND i.token_hash = encode(extensions.digest(COALESCE(p_token, ''), 'sha256'), 'hex')
    AND i.email_sent_at IS NULL
    AND i.accepted_at IS NULL
    AND i.revoked_at IS NULL
    AND i.expires_at > now()
    AND EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.company_id = i.company_id AND m.user_id = p_caller AND m.role = 'owner' AND m.status = 'active'
    )
  RETURNING i.* INTO v_inv;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT gp.full_name INTO v_company_name
  FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
  WHERE c.id = v_inv.company_id;

  RETURN jsonb_build_object('email', v_inv.email, 'company_name', v_company_name, 'expires_at', v_inv.expires_at);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_company_invitation_emailed(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_company_invitation_emailed(uuid, text, uuid) TO service_role;
