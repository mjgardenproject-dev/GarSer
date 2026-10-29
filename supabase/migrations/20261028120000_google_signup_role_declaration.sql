-- Continuar con Google también para jardinero y empresa (2026-10-28).
--
-- El alta por correo manda el rol elegido en los metadatos de supabase.auth.signUp(), y
-- signup_role_from_metadata lo lee al crear el perfil (gardener/company, nunca admin ni
-- employee). Google no tiene ese hueco: signInWithIdToken/signInWithOAuth crean la cuenta con
-- lo que manda Google (nombre, correo, foto), no con nuestra intención de rol — así que toda
-- cuenta nueva por Google nace 'client' (provision_profile_on_signup), sea cual sea la tarjeta
-- que la persona eligió en el selector.
--
-- Esta función deja declarar esa intención DESPUÉS de crear la cuenta, con el mismo nivel de
-- confianza que ya existe al registrarse por correo (self-service, solo gardener o company,
-- nunca admin/employee) — y solo mientras la cuenta siga siendo 'client' recién creada: no sirve
-- para que una cuenta ya establecida cambie de rol por su cuenta más adelante sin pasar por
-- aprobación donde la haya. Reutiliza private.set_account_role_trusted (F3, A-21): el mismo
-- camino de confianza que ya usan las RPC de aprobación de admin.
CREATE OR REPLACE FUNCTION public.self_declare_signup_role(p_role text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_role text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sin sesión.';
  END IF;

  IF p_role NOT IN ('gardener', 'company') THEN
    RAISE EXCEPTION 'Rol no permitido.';
  END IF;

  SELECT role INTO v_current_role FROM public.profiles WHERE user_id = auth.uid();

  -- Silencioso si ya no es 'client' (login normal con el selector aún marcado, doble clic,
  -- reintento): no es un error, simplemente no hay nada que declarar.
  IF v_current_role IS DISTINCT FROM 'client' THEN
    RETURN;
  END IF;

  PERFORM private.set_account_role_trusted(auth.uid(), p_role);
END;
$$;

REVOKE ALL ON FUNCTION public.self_declare_signup_role(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.self_declare_signup_role(text) TO authenticated;
