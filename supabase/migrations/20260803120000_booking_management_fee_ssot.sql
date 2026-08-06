-- Gastos de gestion como dato de primera clase de la reserva.
--
-- PROBLEMA QUE RESUELVE
-- El cliente paga por Stripe SOLO la comision (12,5%) y abona el resto en mano al jardinero.
-- Hasta ahora la comision no existia en ninguna columna: vivia enterrada en el jsonb
-- `pricing_context`. Consecuencia: el checkout mostraba "Total 177,75 €" (servicio+comision)
-- y el email y las tarjetas mostraban "Total 158 €" (solo servicio). El cliente, que ya habia
-- pagado 19,75 €, no podia saber si al profesional le debia 158 o 138,25.
--
-- POR QUE UNA COLUMNA Y NO UN CALCULO
-- La comision NO es derivable de total_price. `respond_booking_price_change` sobrescribe
-- total_price cuando el jardinero cambia el precio y el cliente lo acepta, pero NO se cobra
-- comision adicional. En esas reservas la comision real es la del precio original:
--   servicio 158 → comision 19,75 → el jardinero sube a 200 → comision SIGUE siendo 19,75.
-- Calcular 200 * 0,125 = 25 € mostraria al cliente un importe que nunca pago.
--
-- Ademas plpgsql (trigger de mensajes de chat) no puede importar el SSOT de TypeScript, asi
-- que sin columna habria dos implementaciones de la cascada de fallbacks condenadas a divergir.

-- ---------------------------------------------------------------------------------------
-- 1. Utilidades
-- ---------------------------------------------------------------------------------------

-- Casteo tolerante: `pricing_context` es un jsonb que en vias antiguas venia del navegador,
-- asi que puede contener cualquier cosa. Sin esto, un solo valor no numerico ('N/A', '')
-- aborta el backfill entero con "invalid input syntax for type numeric".
CREATE OR REPLACE FUNCTION public.safe_numeric(p_value text)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_value IS NULL OR BTRIM(p_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN BTRIM(p_value)::numeric;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.safe_numeric(text) IS
  'Castea a numeric devolviendo NULL en vez de lanzar. Para leer importes de jsonb no confiable.';

-- Formato de euros identico al de src/shared/bookingAmounts.ts (formatEuro).
-- Deliberadamente NO usa to_char con separadores de locale: `lc_numeric` depende del cluster
-- y produciria un formato distinto al del navegador y al de los emails. Norma española:
-- el punto de millares solo aparece a partir de cinco cifras enteras (1234 / 12.345).
CREATE OR REPLACE FUNCTION public.format_eur(p_value numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_fixed text;
  v_int   text;
  v_dec   text;
BEGIN
  v_fixed := to_char(ROUND(COALESCE(p_value, 0), 2), 'FM999999999990.00');
  v_int := split_part(v_fixed, '.', 1);
  v_dec := split_part(v_fixed, '.', 2);

  IF length(v_int) > 4 THEN
    v_int := reverse(regexp_replace(reverse(v_int), '(\d{3})(?=\d)', '\1.', 'g'));
  END IF;

  RETURN v_int || ',' || v_dec || ' €';
END;
$$;

COMMENT ON FUNCTION public.format_eur(numeric) IS
  'Formato de euros unico del proyecto (1234,50 € / 12.345,60 €). Espejo de formatEuro en src/shared/bookingAmounts.ts.';

-- ---------------------------------------------------------------------------------------
-- 2. Columnas
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS management_fee numeric(10,2),
  ADD COLUMN IF NOT EXISTS management_fee_source text;

COMMENT ON COLUMN public.bookings.management_fee IS
  'Gastos de gestion cobrados al cliente por Stripe. Hecho contable INMUTABLE: no se recalcula '
  'si total_price cambia por respond_booking_price_change. Desembolso del cliente = total_price + management_fee.';
COMMENT ON COLUMN public.bookings.management_fee_source IS
  'Procedencia del importe. "unknown" = no consta comision fiable; la UI oculta el desglose en vez de inventarlo.';

-- ---------------------------------------------------------------------------------------
-- 3. Cascada de resolucion: UNA sola implementacion para el backfill y para el trigger
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resolve_booking_management_fee(
  p_pricing_context jsonb,
  p_booking_id uuid DEFAULT NULL
)
RETURNS TABLE (fee numeric, source text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id uuid;
  v_cents integer;
  v_value numeric;
BEGIN
  -- 1. El intento de pago es la fuente MAS autoritativa: es el importe que realmente se
  --    autorizo en Stripe, tipado como integer NOT NULL CHECK (> 0). Lo que hay en
  --    pricing_context es una copia suya.
  v_attempt_id := NULLIF(BTRIM(COALESCE(p_pricing_context ->> 'payment_attempt_id', '')), '')::uuid;

  IF v_attempt_id IS NOT NULL THEN
    SELECT a.payable_now_amount_cents INTO v_cents
    FROM public.booking_payment_attempts a
    WHERE a.id = v_attempt_id;
  END IF;

  IF v_cents IS NULL AND p_booking_id IS NOT NULL THEN
    SELECT a.payable_now_amount_cents INTO v_cents
    FROM public.booking_payment_attempts a
    WHERE a.booking_id = p_booking_id
    ORDER BY a.confirmed_at DESC NULLS LAST, a.created_at DESC
    LIMIT 1;
  END IF;

  IF v_cents IS NOT NULL AND v_cents > 0 THEN
    RETURN QUERY SELECT ROUND(v_cents::numeric / 100, 2), 'payment_attempt'::text;
    RETURN;
  END IF;

  -- 2. Copia en el contexto de precios (centimos).
  v_value := public.safe_numeric(p_pricing_context ->> 'payable_now_amount_cents');
  IF v_value IS NOT NULL AND v_value > 0 THEN
    RETURN QUERY SELECT ROUND(v_value / 100, 2), 'pricing_context_cents'::text;
    RETURN;
  END IF;

  -- 3/4. Snapshot economico de la cotizacion firmada (euros).
  v_value := public.safe_numeric(p_pricing_context #>> '{quote_economic_snapshot,payableNow}');
  IF v_value IS NOT NULL AND v_value > 0 THEN
    RETURN QUERY SELECT ROUND(v_value, 2), 'quote_snapshot_payable_now'::text;
    RETURN;
  END IF;

  v_value := public.safe_numeric(p_pricing_context #>> '{quote_economic_snapshot,managementFee}');
  IF v_value IS NOT NULL AND v_value > 0 THEN
    RETURN QUERY SELECT ROUND(v_value, 2), 'quote_snapshot_management_fee'::text;
    RETURN;
  END IF;

  -- Sin dato fiable. NO se usa total_price * 0,125 como ultimo recurso: es justo el calculo
  -- que miente en reservas con cambio de precio aceptado. Preferimos degradar honestamente.
  RETURN QUERY SELECT 0::numeric, 'unknown'::text;
END;
$$;

COMMENT ON FUNCTION public.resolve_booking_management_fee(jsonb, uuid) IS
  'Cascada de resolucion de los gastos de gestion. Compartida por el backfill y el trigger de bookings.';

-- ---------------------------------------------------------------------------------------
-- 4. Backfill
-- ---------------------------------------------------------------------------------------

-- El LATERAL va dentro del subselect: Postgres no permite correlacionar la clausula FROM de
-- un UPDATE con la propia tabla que se actualiza.
UPDATE public.bookings b
SET management_fee = r.fee,
    management_fee_source = r.source
FROM (
  SELECT src.id, resolved.fee, resolved.source
  FROM public.bookings src
  CROSS JOIN LATERAL public.resolve_booking_management_fee(src.pricing_context, src.id) AS resolved
  WHERE src.management_fee IS NULL
) r
WHERE r.id = b.id;

-- Cinturon: cualquier fila que la cascada no haya tocado queda explicitamente marcada.
UPDATE public.bookings
SET management_fee = COALESCE(management_fee, 0),
    management_fee_source = COALESCE(management_fee_source, 'unknown')
WHERE management_fee IS NULL OR management_fee_source IS NULL;

-- ---------------------------------------------------------------------------------------
-- 5. Restricciones
-- ---------------------------------------------------------------------------------------

ALTER TABLE public.bookings
  ALTER COLUMN management_fee SET NOT NULL,
  ALTER COLUMN management_fee_source SET NOT NULL;

-- Sin DEFAULT a proposito: un 0 por defecto seria indistinguible de "se me olvido escribirlo"
-- y colapsaria el total del cliente al precio del servicio, que es la ambiguedad a eliminar.
-- El trigger de mas abajo se encarga de rellenarlo en toda via de insercion.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_management_fee_nonneg,
  ADD CONSTRAINT bookings_management_fee_nonneg CHECK (management_fee >= 0);

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_management_fee_source_check,
  ADD CONSTRAINT bookings_management_fee_source_check CHECK (
    management_fee_source IN (
      'payment_attempt',
      'pricing_context_cents',
      'quote_snapshot_payable_now',
      'quote_snapshot_management_fee',
      'unknown'
    )
  );

-- Columna generada: imposible que se desincronice cuando total_price muta. Ninguna via de
-- escritura puede equivocarse porque ninguna puede escribirla.
ALTER TABLE public.bookings
  DROP COLUMN IF EXISTS client_total_price;
ALTER TABLE public.bookings
  ADD COLUMN client_total_price numeric(12,2)
  GENERATED ALWAYS AS (COALESCE(total_price, 0) + COALESCE(management_fee, 0)) STORED;

COMMENT ON COLUMN public.bookings.client_total_price IS
  'Desembolso total del cliente (servicio + gastos de gestion). Generada: no se puede escribir ni desincronizar.';

-- ---------------------------------------------------------------------------------------
-- 6. Trigger: rellena en INSERT y congela en UPDATE
-- ---------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bookings_management_fee_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee numeric;
  v_source text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Se deriva aqui, y no dentro de confirm_booking_payment_attempt, para que valga para
    -- CUALQUIER via de insercion (presente o futura) sin duplicar la cascada.
    IF NEW.management_fee IS NULL OR NEW.management_fee_source IS NULL THEN
      SELECT r.fee, r.source INTO v_fee, v_source
      FROM public.resolve_booking_management_fee(COALESCE(NEW.pricing_context, '{}'::jsonb), NEW.id) AS r;

      NEW.management_fee := COALESCE(NEW.management_fee, v_fee, 0);
      NEW.management_fee_source := COALESCE(NEW.management_fee_source, v_source, 'unknown');
    END IF;
    RETURN NEW;
  END IF;

  -- La comision cobrada es un hecho pasado. Congelarla es lo que garantiza que el desglose
  -- siga cuadrando cuando total_price cambia por un cambio de precio aceptado.
  IF NEW.management_fee IS DISTINCT FROM OLD.management_fee
     OR NEW.management_fee_source IS DISTINCT FROM OLD.management_fee_source THEN
    RAISE EXCEPTION 'Los gastos de gestion de una reserva son inmutables (reserva %).', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_management_fee_guard ON public.bookings;
CREATE TRIGGER trg_bookings_management_fee_guard
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_management_fee_guard();

-- ---------------------------------------------------------------------------------------
-- 7. Vias de creacion muertas
-- ---------------------------------------------------------------------------------------
-- `create_atomic_booking` y `create_broadcast_booking_requests` solo eran alcanzables desde
-- src/utils/bookingBroadcastService.ts, que no importa nadie fuera de su propio test. Insertan
-- en bookings con un pricing_context suministrado por el navegador, de modo que su comision
-- caeria siempre en 'unknown'. Se revoca su ejecucion en vez de DROP para no romper el
-- historial de migraciones que las referencia.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'create_atomic_booking') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_atomic_booking FROM PUBLIC, anon, authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'create_broadcast_booking_requests') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.create_broadcast_booking_requests FROM PUBLIC, anon, authenticated';
  END IF;
END;
$$;
