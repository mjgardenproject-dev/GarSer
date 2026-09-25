-- GarSer Empresas · F3.2: el correo de la cuenta en la solicitud de empresa.
--
-- El admin necesita el correo para revisar la solicitud (y F3.4 para escribir a la empresa).
-- No lo escribe el navegador: lo copia el servidor desde auth.users al ENVIAR la solicitud, así
-- no se puede falsear. Por eso la columna no entra en los privilegios de INSERT/UPDATE de F3.1.

ALTER TABLE public.company_applications ADD COLUMN IF NOT EXISTS email text;

CREATE OR REPLACE FUNCTION public.submit_company_application(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.company_applications%ROWTYPE;
  v_missing text[] := '{}';
BEGIN
  SELECT * INTO v_app FROM public.company_applications WHERE id = p_application_id FOR UPDATE;
  IF NOT FOUND OR v_app.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;
  IF v_app.status <> 'draft' THEN
    RAISE EXCEPTION 'Esta solicitud ya se ha enviado.';
  END IF;

  IF COALESCE(BTRIM(v_app.commercial_name), '') = '' THEN v_missing := array_append(v_missing, 'nombre comercial'); END IF;
  IF COALESCE(BTRIM(v_app.legal_name), '') = '' THEN v_missing := array_append(v_missing, 'razón social'); END IF;
  IF COALESCE(BTRIM(v_app.tax_id), '') = '' THEN v_missing := array_append(v_missing, 'CIF'); END IF;
  IF COALESCE(BTRIM(v_app.contact_name), '') = '' THEN v_missing := array_append(v_missing, 'persona de contacto'); END IF;
  IF COALESCE(BTRIM(v_app.phone), '') = '' THEN v_missing := array_append(v_missing, 'teléfono'); END IF;
  IF COALESCE(BTRIM(v_app.address), '') = '' THEN v_missing := array_append(v_missing, 'dirección'); END IF;
  IF COALESCE(BTRIM(v_app.city_zone), '') = '' THEN v_missing := array_append(v_missing, 'zona de trabajo'); END IF;
  IF COALESCE(array_length(v_app.services, 1), 0) = 0 THEN v_missing := array_append(v_missing, 'servicios'); END IF;
  IF NOT v_app.accept_terms THEN v_missing := array_append(v_missing, 'aceptar las condiciones'); END IF;
  IF NOT v_app.declaration_truth THEN v_missing := array_append(v_missing, 'declarar que los datos son ciertos'); END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION 'Falta: %.', array_to_string(v_missing, ', ');
  END IF;

  UPDATE public.company_applications
  SET status = 'submitted',
      submitted_at = now(),
      updated_at = now(),
      email = (SELECT email FROM auth.users WHERE id = v_app.user_id)
  WHERE id = p_application_id;

  RETURN jsonb_build_object('application_id', p_application_id, 'status', 'submitted');
END;
$$;
