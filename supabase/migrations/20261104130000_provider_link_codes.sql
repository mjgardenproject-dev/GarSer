-- Comisiones configurables (2026-11-04), parte 4/4: el enlace del profesional lleva una clave.
--
-- El fallo que cierra
--   El enlace de un profesional era garser.es/reservar/<identificador>, y ese identificador no es
--   secreto (sale en el directorio público). Al pedir un presupuesto la web declaraba «vengo del
--   enlace de X» y el servidor se lo creía: cualquiera que conociera el identificador de un
--   profesional podía abrir su enlace, reservar sin gastos de gestión (0 %) aunque hubiera conocido
--   al profesional en el marketplace de GarSer, y quedar guardado como «cliente del profesional».
--
-- Cómo se cierra (decisión del dueño, 2026-11-04)
--   Cada profesional tiene una CLAVE de enlace (provider_booking_links.code): 128 bits aleatorios que
--   solo ve él, en su cuenta. Su enlace pasa a ser garser.es/reservar/<id>?c=<clave>. El servidor
--   solo concede el origen «enlace» si la reserva llega con la clave de ESE profesional (la
--   comprobación vive aquí, en SQL, junto al resto de la decisión de comisión). Sin clave, o con una
--   clave que no es la suya, la declaración se RECHAZA: se anota (linkClaim = 'rejected') y la reserva
--   paga como cualquier cliente de GarSer.
--
-- Lo que NO cambia
--   · Las cinco reglas, su prioridad y los porcentajes.
--   · Que el origen de un cliente con un profesional se guarda con su primera reserva y no cambia.
--   · Que la visita de un plan paga siempre la regla del plan.
--   · Sin ventana de transición: los enlaces sin clave dejan de eximir desde el primer día (no hay
--     profesionales reales todavía; decisión del dueño).
--
-- Detalles
--   · La clave es de enlace, no de acceso: sirve para reservar con ese profesional y nada más. Si un
--     profesional la reparte en abierto, es decisión suya; si se filtra, la cambia (rotate_my_booking_link)
--     y las anteriores dejan de valer.
--   · Verificada la clave al firmar el presupuesto, el pago revalida con ese resultado (p_claim_verified)
--     sin volver a necesitar la clave.
--   · Cambian las firmas de resolve_booking_commission y quote_commission_economics (llevan la clave y el
--     resultado verificado): se retiran las anteriores para que no queden dos con el mismo nombre. Las
--     migraciones 20261102* no se han aplicado a producción, y esta las sustituye en orden.

-- ── 1) Las claves ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_booking_links (
  provider_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE CHECK (code ~ '^[0-9a-f]{32}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  rotations integer NOT NULL DEFAULT 0 CHECK (rotations >= 0)
);

COMMENT ON TABLE public.provider_booking_links IS
  'Clave del enlace de reserva de cada profesional (garser.es/reservar/<id>?c=<clave>). Secreta: solo la lee el propio profesional por my_booking_link() y la comprueba SQL al decidir la comisión. Nadie más tiene acceso.';

ALTER TABLE public.provider_booking_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.provider_booking_links FROM PUBLIC, anon, authenticated, service_role;

-- ── 2) Comprobar, consultar y cambiar la clave ───────────────────────────────────────────
-- ¿Es esta la clave del enlace de este profesional? Solo la llaman otras funciones de SQL (como
-- propietarias): ni el navegador ni el servidor la ejecutan, para que no sirva de oráculo.
CREATE OR REPLACE FUNCTION public.provider_link_code_matches(p_provider_id uuid, p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT l.code = lower(btrim(p_code))
    FROM public.provider_booking_links l
    WHERE l.provider_id = p_provider_id
  ), false);
$$;

-- El enlace del profesional de la sesión. Crea su clave la primera vez. Solo un profesional (tiene
-- ficha de profesional: autónomo o empresa) tiene enlace; un cliente o un empleado, no.
CREATE OR REPLACE FUNCTION public.my_booking_link()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.gardener_profiles g WHERE g.user_id = v_uid) THEN
    RAISE EXCEPTION 'Solo un profesional tiene enlace de reserva.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.provider_booking_links (provider_id, code)
  VALUES (v_uid, replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (provider_id) DO NOTHING;
  SELECT l.code INTO v_code FROM public.provider_booking_links l WHERE l.provider_id = v_uid;
  RETURN jsonb_build_object('providerId', v_uid, 'code', v_code);
END;
$$;

-- Cambia la clave: los enlaces y los QR anteriores dejan de eximir (siguen abriendo su perfil).
CREATE OR REPLACE FUNCTION public.rotate_my_booking_link()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM public.gardener_profiles g WHERE g.user_id = v_uid) THEN
    RAISE EXCEPTION 'Solo un profesional tiene enlace de reserva.' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.provider_booking_links (provider_id, code)
  VALUES (v_uid, replace(gen_random_uuid()::text, '-', ''))
  ON CONFLICT (provider_id) DO UPDATE
    SET code = EXCLUDED.code,
        rotated_at = now(),
        rotations = public.provider_booking_links.rotations + 1
  RETURNING code INTO v_code;
  RETURN jsonb_build_object('providerId', v_uid, 'code', v_code);
END;
$$;

-- ── 3) La economía de un presupuesto: ahora recuerda el resultado del enlace ─────────────
-- Igual que en 20261102140000, con una clave opcional más en la comisión: linkClaim (verified |
-- rejected | null). Solo se escribe si la decisión la trae, así un presupuesto anterior sigue
-- siendo idéntico al volver a aplicarle su decisión.
CREATE OR REPLACE FUNCTION public.apply_commission_to_economics(p_economics jsonb, p_decision jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_rules constant text[] := ARRAY['garser_first', 'link_first', 'garser_repeat', 'maintenance_visit', 'link_repeat'];
  v_rule text;
  v_origin text;
  v_claimed jsonb;
  v_link_claim text;
  v_link_claim_present boolean := false;
  v_version numeric;
  v_bps_raw numeric;
  v_bps integer;
  v_base numeric;
  v_base_cents bigint;
  v_calc_cents bigint;
  v_fee_cents bigint := 0;
  v_fee numeric;
  v_adjustment text;
  v_reason text;
  v_stripped jsonb;
  v_out jsonb;
BEGIN
  -- IS DISTINCT FROM y no <>: con una clave ausente jsonb_typeof es NULL, y NULL <> 'number' no
  -- lanza nada. Una decisión incompleta nunca debe convertirse en una comisión de 0.
  IF p_economics IS NULL OR jsonb_typeof(p_economics) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_economics -> 'serviceGrossTotal') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'La economía del presupuesto no permite calcular la comisión.' USING ERRCODE = 'P0001';
  END IF;
  IF p_decision IS NULL OR jsonb_typeof(p_decision) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Falta la decisión de comisión.' USING ERRCODE = 'P0001';
  END IF;

  v_rule := p_decision ->> 'rule';
  IF v_rule IS NULL OR NOT (v_rule = ANY (v_rules)) THEN
    RAISE EXCEPTION 'Regla de comisión desconocida: %.', COALESCE(v_rule, '(vacía)') USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_decision -> 'rateBps') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'La decisión de comisión no trae porcentaje.' USING ERRCODE = 'P0001';
  END IF;
  v_bps_raw := (p_decision ->> 'rateBps')::numeric;
  IF v_bps_raw < 0 OR v_bps_raw > 10000 OR v_bps_raw <> trunc(v_bps_raw) THEN
    RAISE EXCEPTION 'Porcentaje de comisión fuera de rango (%).', v_bps_raw USING ERRCODE = 'P0001';
  END IF;
  v_bps := v_bps_raw::integer;

  IF jsonb_typeof(p_decision -> 'configVersion') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'La decisión de comisión no trae versión de configuración.' USING ERRCODE = 'P0001';
  END IF;
  v_version := (p_decision ->> 'configVersion')::numeric;
  IF v_version < 1 OR v_version <> trunc(v_version) THEN
    RAISE EXCEPTION 'Versión de configuración de comisiones no válida (%).', v_version USING ERRCODE = 'P0001';
  END IF;

  v_origin := COALESCE(p_decision ->> 'origin', 'garser');
  IF v_origin NOT IN ('garser', 'provider_link') THEN
    RAISE EXCEPTION 'Origen de cliente desconocido: %.', v_origin USING ERRCODE = 'P0001';
  END IF;
  v_claimed := p_decision -> 'claimedOrigin';
  IF v_claimed IS NOT NULL AND jsonb_typeof(v_claimed) <> 'null' AND v_claimed <> '"provider_link"'::jsonb THEN
    RAISE EXCEPTION 'Origen declarado no válido.' USING ERRCODE = 'P0001';
  END IF;
  -- Resultado de contrastar el enlace declarado con la clave del profesional. Es opcional (los
  -- presupuestos anteriores a esta migración no lo traen) y, si está, solo puede ser verified o
  -- rejected y solo con un origen declarado.
  IF p_decision ? 'linkClaim' THEN
    v_link_claim_present := true;
    v_link_claim := p_decision ->> 'linkClaim';
    IF v_link_claim IS NOT NULL AND v_link_claim NOT IN ('verified', 'rejected') THEN
      RAISE EXCEPTION 'Resultado del enlace no válido: %.', v_link_claim USING ERRCODE = 'P0001';
    END IF;
    IF v_link_claim IS NOT NULL AND (v_claimed IS NULL OR jsonb_typeof(v_claimed) = 'null') THEN
      RAISE EXCEPTION 'Un enlace contrastado necesita un origen declarado.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- ── La cuenta, en céntimos enteros ──
  v_base := round((p_economics ->> 'serviceGrossTotal')::numeric, 2);
  v_base_cents := (v_base * 100)::bigint;
  v_calc_cents := round(v_base_cents::numeric * v_bps / 10000)::bigint;

  IF v_base_cents <= 0 THEN
    v_fee_cents := 0;
  ELSIF v_bps = 0 THEN
    v_fee_cents := 0;
    v_reason := CASE v_rule
      WHEN 'link_first' THEN 'provider_link'
      WHEN 'garser_repeat' THEN 'returning_client'
      WHEN 'link_repeat' THEN 'returning_client'
      WHEN 'maintenance_visit' THEN 'maintenance_plan'
      ELSE 'zero_commission'
    END;
  ELSIF v_calc_cents < public.commission_minimum_charge_cents() THEN
    v_fee_cents := public.commission_minimum_charge_cents();
    v_adjustment := 'minimum_charge';
  ELSE
    v_fee_cents := v_calc_cents;
  END IF;
  v_fee := round(v_fee_cents::numeric / 100, 2);

  v_stripped := public.strip_commission_from_economics(p_economics);
  v_out := v_stripped || jsonb_build_object(
    'managementFee', v_fee,
    'payableNow', v_fee,
    'commission', jsonb_build_object(
      'rule', v_rule,
      'rateBps', v_bps,
      'ratePercent', round(v_bps::numeric / 100, 2),
      'configVersion', v_version::bigint,
      'origin', v_origin,
      'claimedOrigin', CASE WHEN v_claimed IS NULL OR jsonb_typeof(v_claimed) = 'null' THEN NULL ELSE v_claimed #>> '{}' END,
      'isFirstBooking', COALESCE((p_decision ->> 'isFirstBooking')::boolean, false),
      'baseAmount', v_base,
      'calculatedAmount', round(v_calc_cents::numeric / 100, 2),
      'amount', v_fee,
      'adjustment', v_adjustment
    ) || CASE WHEN v_link_claim_present THEN jsonb_build_object('linkClaim', v_link_claim) ELSE '{}'::jsonb END
  );

  IF v_fee_cents > 0 THEN
    v_out := v_out || jsonb_build_object(
      'lines', (v_stripped -> 'lines') || jsonb_build_array(jsonb_build_object(
        'code', 'management_fee', 'label', 'Gastos de gestión', 'amount', v_fee, 'kind', 'fee')),
      'stripeLineItems', jsonb_build_array(jsonb_build_object(
        'code', 'management_fee', 'label', 'Gastos de gestión', 'unitAmount', v_fee, 'quantity', 1))
    );
  ELSIF v_reason IS NOT NULL THEN
    v_out := v_out || jsonb_build_object(
      'feeWaiver', jsonb_build_object('reason', v_reason, 'waivedFee', 0)
    );
  END IF;

  RETURN v_out;
END;
$$;

-- ── 4) Qué regla toca, ahora contrastando el enlace ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint);
DROP FUNCTION IF EXISTS public.resolve_booking_commission(uuid, uuid, text, boolean, bigint);

-- p_claimed_origin: lo que declara la web ('provider_link' si la reserva empezó en el enlace de ESTE
--   profesional; el servidor ya lo ha contrastado con el profesional del presupuesto).
-- p_link_code: la clave que traía ese enlace. Sin ella, o si no es la del profesional, la
--   declaración se rechaza (linkClaim = 'rejected') y no cuenta.
-- p_claim_verified: SOLO para el servidor al revalidar un pago: el presupuesto firmado ya dejó
--   anotado que la clave era la buena (linkClaim = 'verified'), y no hace falta volver a pedirla.
-- p_config_version: NULL = la configuración vigente; un número = esa versión del historial.
CREATE OR REPLACE FUNCTION public.resolve_booking_commission(
  p_client_id uuid,
  p_provider_id uuid,
  p_claimed_origin text,
  p_maintenance_visit boolean DEFAULT false,
  p_config_version bigint DEFAULT NULL,
  p_link_code text DEFAULT NULL,
  p_claim_verified boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version bigint;
  v_rates public.commission_settings_history%ROWTYPE;
  v_origin text;
  v_first boolean := true;
  v_rule text;
  v_percent numeric;
  v_claim_ok boolean := false;
  v_link_claim text := NULL;
BEGIN
  v_version := COALESCE(p_config_version, (SELECT s.version FROM public.commission_settings s WHERE s.id = 1));
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'commission_config_unavailable'
      USING ERRCODE = 'P0001', DETAIL = 'No existe la fila de configuración de comisiones.';
  END IF;
  SELECT * INTO v_rates FROM public.commission_settings_history h WHERE h.version = v_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'commission_config_unavailable'
      USING ERRCODE = 'P0001', DETAIL = format('La versión %s de la configuración de comisiones no existe.', v_version);
  END IF;

  -- El enlace declarado solo cuenta si trae la clave de ese profesional.
  IF p_claimed_origin = 'provider_link' THEN
    IF COALESCE(p_claim_verified, false) THEN
      v_claim_ok := true;
    ELSIF p_provider_id IS NOT NULL AND public.provider_link_code_matches(p_provider_id, p_link_code) THEN
      v_claim_ok := true;
    END IF;
    v_link_claim := CASE WHEN v_claim_ok THEN 'verified' ELSE 'rejected' END;
  END IF;

  IF p_client_id IS NOT NULL AND p_provider_id IS NOT NULL THEN
    SELECT r.origin INTO v_origin
    FROM public.client_provider_relationships r
    WHERE r.client_id = p_client_id AND r.provider_id = p_provider_id;

    v_first := NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.client_id = p_client_id
        AND b.gardener_id = p_provider_id
        AND b.status = 'completed'
    );
  END IF;

  -- Sin relación guardada, vale el enlace contrastado; con relación, manda la guardada.
  IF v_origin IS NULL THEN
    v_origin := CASE WHEN v_claim_ok THEN 'provider_link' ELSE 'garser' END;
  END IF;

  v_rule := CASE
    WHEN COALESCE(p_maintenance_visit, false) THEN 'maintenance_visit'
    WHEN v_origin = 'provider_link' AND v_first THEN 'link_first'
    WHEN v_origin = 'provider_link' THEN 'link_repeat'
    WHEN v_first THEN 'garser_first'
    ELSE 'garser_repeat'
  END;

  v_percent := CASE v_rule
    WHEN 'garser_first' THEN v_rates.rate_garser_first
    WHEN 'link_first' THEN v_rates.rate_link_first
    WHEN 'garser_repeat' THEN v_rates.rate_garser_repeat
    WHEN 'maintenance_visit' THEN v_rates.rate_maintenance_visit
    ELSE v_rates.rate_link_repeat
  END;

  RETURN jsonb_build_object(
    'rule', v_rule,
    'rateBps', (v_percent * 100)::integer,
    'ratePercent', v_percent,
    'configVersion', v_version,
    'origin', v_origin,
    'claimedOrigin', CASE WHEN p_claimed_origin = 'provider_link' THEN 'provider_link' ELSE NULL END,
    'linkClaim', v_link_claim,
    'isFirstBooking', v_first AND NOT COALESCE(p_maintenance_visit, false)
  );
END;
$$;

-- Lo que llama el servidor: economía del motor de precios (solo servicio) → economía con comisión.
CREATE OR REPLACE FUNCTION public.quote_commission_economics(
  p_economics jsonb,
  p_client_id uuid,
  p_provider_id uuid,
  p_claimed_origin text,
  p_maintenance_visit boolean DEFAULT false,
  p_config_version bigint DEFAULT NULL,
  p_link_code text DEFAULT NULL,
  p_claim_verified boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.apply_commission_to_economics(
    p_economics,
    public.resolve_booking_commission(
      p_client_id, p_provider_id, p_claimed_origin, p_maintenance_visit, p_config_version, p_link_code, p_claim_verified
    )
  );
$$;

-- ── 5) Cinturón en los intentos de pago: una comisión de enlace o de «reserva posterior» se justifica ─
-- Misma comprobación de 20261102140000 (la comisión es la del historial y el importe a cobrar es esa
-- comisión) MÁS dos justificaciones, para que ni un fallo del servidor ni una escritura directa
-- puedan colar un 0 % o un 3 % que el cliente no merece:
--   · origen «enlace» (link_first / link_repeat): o la clave se verificó al firmar (linkClaim =
--     'verified'), o el cliente ya tiene guardado el origen «enlace» con este profesional;
--   · reserva posterior (garser_repeat / link_repeat): existe una reserva COMPLETADA del cliente con
--     este profesional.
-- La visita de un plan no se comprueba aquí: la genera el reloj de la base de datos.
CREATE OR REPLACE FUNCTION public.booking_payment_attempts_commission_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problem text;
  v_commission jsonb;
  v_rule text;
BEGIN
  IF jsonb_typeof(NEW.economic_snapshot) = 'object' AND NEW.economic_snapshot ? 'commission' THEN
    v_problem := public.commission_snapshot_problem(NEW.economic_snapshot);
    IF v_problem IS NULL
       AND NEW.payable_now_amount_cents IS DISTINCT FROM
           round((NEW.economic_snapshot ->> 'payableNow')::numeric * 100)::integer THEN
      v_problem := 'el importe a pagar no coincide con la comisión';
    END IF;

    IF v_problem IS NULL THEN
      v_commission := NEW.economic_snapshot -> 'commission';
      v_rule := v_commission ->> 'rule';
      IF v_rule IN ('link_first', 'link_repeat')
         AND COALESCE(v_commission ->> 'linkClaim', '') <> 'verified'
         AND NOT EXISTS (
           SELECT 1 FROM public.client_provider_relationships r
           WHERE r.client_id = NEW.client_id AND r.provider_id = NEW.gardener_id AND r.origin = 'provider_link'
         ) THEN
        v_problem := 'el origen «enlace» no está justificado';
      END IF;
      IF v_problem IS NULL AND v_rule IN ('garser_repeat', 'link_repeat')
         AND NOT EXISTS (
           SELECT 1 FROM public.bookings b
           WHERE b.client_id = NEW.client_id AND b.gardener_id = NEW.gardener_id AND b.status = 'completed'
         ) THEN
        v_problem := 'no hay una reserva completada anterior';
      END IF;
    END IF;

    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'El presupuesto no tiene una comisión válida (%). Vuelve a seleccionar el profesional.', v_problem
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 6) Quién puede ejecutar qué ──────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.provider_link_code_matches(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_booking_commission(uuid, uuid, text, boolean, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_booking_commission(uuid, uuid, text, boolean, bigint, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.quote_commission_economics(jsonb, uuid, uuid, text, boolean, bigint, text, boolean) TO service_role;

-- La clave la consulta y la cambia el propio profesional (la función comprueba que lo es).
REVOKE ALL ON FUNCTION public.my_booking_link() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rotate_my_booking_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_booking_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_my_booking_link() TO authenticated;
