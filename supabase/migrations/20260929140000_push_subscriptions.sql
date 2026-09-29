-- Prueba real (2026-09-28) · F7: notificaciones al móvil (R-08, D25).
--
-- Cada dispositivo en el que el usuario activa las notificaciones guarda aquí su suscripción de
-- web push. `send-email-notification` envía, además de cada correo, una notificación a las
-- suscripciones del destinatario; las caducadas (404/410) se borran solas.
-- Seguridad: solo servicios de push conocidos y por https (lo comprueba también el envío): el
-- endpoint lo manda el navegador, y sin esto se podría usar el servidor para llamar a cualquier
-- dirección (SSRF). Cada usuario solo ve y borra las suyas.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  CONSTRAINT push_subscriptions_endpoint_allowed CHECK (
    endpoint ~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
  ),
  CONSTRAINT push_subscriptions_keys_len CHECK (length(p256dh) BETWEEN 80 AND 100 AND length(auth) BETWEEN 16 AND 32)
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO service_role;
GRANT SELECT, DELETE ON public.push_subscriptions TO authenticated;
DROP POLICY IF EXISTS "Own push subscriptions (read)" ON public.push_subscriptions;
CREATE POLICY "Own push subscriptions (read)" ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Own push subscriptions (delete)" ON public.push_subscriptions;
CREATE POLICY "Own push subscriptions (delete)" ON public.push_subscriptions FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Guardar la suscripción de este dispositivo. Si el mismo navegador tenía otra cuenta, pasa a
-- esta (un dispositivo avisa a quien ha entrado en él, no a la cuenta anterior).
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  ON CONFLICT (endpoint) DO UPDATE
    SET user_id = auth.uid(), p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent, created_at = now();
  -- Tope por cuenta: los 10 dispositivos más recientes.
  DELETE FROM public.push_subscriptions s
  WHERE s.user_id = auth.uid()
    AND s.id NOT IN (SELECT id FROM public.push_subscriptions WHERE user_id = auth.uid() ORDER BY created_at DESC LIMIT 10);
END;
$$;
REVOKE ALL ON FUNCTION public.save_push_subscription(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text, text) TO authenticated;

-- Para el servidor: las suscripciones de quien recibe un correo.
CREATE OR REPLACE FUNCTION public.push_subscriptions_for_email(p_email text)
RETURNS TABLE (id uuid, endpoint text, p256dh text, auth text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id, s.endpoint, s.p256dh, s.auth
  FROM public.push_subscriptions s
  JOIN auth.users u ON u.id = s.user_id
  WHERE lower(u.email) = lower(btrim(p_email));
$$;
REVOKE ALL ON FUNCTION public.push_subscriptions_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.push_subscriptions_for_email(text) TO service_role;
