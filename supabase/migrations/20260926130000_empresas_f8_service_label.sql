-- GarSer Empresas · F8.4: el nombre de lo reservado cuando una reserva lleva varios servicios.
-- booking_service_label(): «Corte de césped + Poda de setos» (en su orden); con uno, o en
-- reservas anteriores sin booking_items, el nombre del servicio de siempre. Lo usan la agenda de
-- la empresa, la del empleado y los mensajes automáticos del chat.

CREATE OR REPLACE FUNCTION public.booking_service_label(p_booking_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT string_agg(s.name, ' + ' ORDER BY i.position)
     FROM public.booking_items i JOIN public.services s ON s.id = i.service_id
     WHERE i.booking_id = p_booking_id
     HAVING count(*) > 1),
    -- Justo al crear la reserva (mensaje «Reserva solicitada» del chat) aún no hay filas: los
    -- servicios del presupuesto del que sale.
    (SELECT string_agg(COALESCE(NULLIF(t.x ->> 'serviceName', ''), s.name), ' + ' ORDER BY t.o)
     FROM public.bookings b
     JOIN public.booking_quotes q ON q.id::text = b.pricing_context ->> 'quote_id'
     CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(q.items) = 'array' THEN q.items ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, o)
     LEFT JOIN public.services s ON s.id::text = t.x ->> 'serviceId'
     WHERE b.id = p_booking_id AND jsonb_array_length(q.items) > 1),
    (SELECT s.name FROM public.bookings b JOIN public.services s ON s.id = b.service_id WHERE b.id = p_booking_id)
  );
$$;
REVOKE ALL ON FUNCTION public.booking_service_label(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_service_label(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.company_schedule(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company public.companies%ROWTYPE;
BEGIN
  SELECT * INTO v_company FROM public.companies WHERE id = public.my_company_id();
  IF NOT FOUND OR NOT public.is_company_owner(v_company.id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver la agenda de su equipo.';
  END IF;
  IF p_to < p_from OR p_to - p_from > 31 THEN
    RAISE EXCEPTION 'Elige como mucho un mes.';
  END IF;

  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'name', COALESCE(NULLIF(BTRIM(p.full_name), ''), u.email),
        'role', m.role,
        'works', m.counts_as_labour
      ) ORDER BY (m.role = 'owner') DESC, p.full_name)
      FROM public.company_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE m.company_id = v_company.id AND m.status = 'active'
    ), '[]'::jsonb),
    'free', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('user_id', x.gardener_id, 'date', x.date, 'hours', x.hours))
      FROM (
        SELECT a.gardener_id, a.date, array_agg(DISTINCT EXTRACT(HOUR FROM a.start_time)::integer ORDER BY EXTRACT(HOUR FROM a.start_time)::integer) AS hours
        FROM public.availability a
        JOIN public.company_members m ON m.user_id = a.gardener_id AND m.company_id = v_company.id AND m.status = 'active'
        WHERE a.date BETWEEN p_from AND p_to AND a.is_available
        GROUP BY a.gardener_id, a.date
      ) x
    ), '[]'::jsonb),
    'jobs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'booking_id', b.id,
        'date', b.date,
        'start_hour', EXTRACT(HOUR FROM b.start_time)::integer,
        'duration', b.duration_hours,
        'end_date', b.end_date,
        'labour_hours', b.labour_hours,
        'status', b.status,
        'service', public.booking_service_label(b.id),
        'client_name', NULLIF(split_part(BTRIM(COALESCE(cp.full_name, '')), ' ', 1), ''),
        'address', b.client_address,
        'assignment_pending', b.assignment_pending,
        'reschedule_status', b.reschedule_status,
        'proposed_date', b.proposed_date,
        'proposed_start_hour', EXTRACT(HOUR FROM b.proposed_start_time)::integer,
        'hours', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('date', bb.date, 'hour', bb.hour_block, 'worker_id', bb.assignee_id) ORDER BY bb.date, bb.hour_block, bb.assignee_id)
          FROM public.booking_blocks bb WHERE bb.booking_id = b.id
        ), '[]'::jsonb)
      ) ORDER BY b.date, b.start_time)
      FROM public.bookings b
      JOIN public.services s ON s.id = b.service_id
      LEFT JOIN public.profiles cp ON cp.user_id = b.client_id
      WHERE b.gardener_id = v_company.provider_user_id
        AND b.date <= p_to AND COALESCE(b.end_date, b.date) >= p_from
        AND b.status IN ('pending', 'confirmed', 'in_progress', 'disputed', 'completed')
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.my_jobs(p_from date, p_to date)
 RETURNS TABLE(booking_id uuid, date date, start_time time without time zone, duration_hours integer, status text, service_name text, client_address text, client_name text, client_phone text, notes text, company_name text, assignment_pending boolean, finished_at timestamp with time zone, service_start timestamp with time zone, my_hours integer[], end_date date, labour_hours integer, team_size integer, my_days jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT b.id, b.date, b.start_time::time, b.duration_hours, b.status, public.booking_service_label(b.id),
         b.client_address, NULLIF(BTRIM(cp.full_name), ''), NULLIF(BTRIM(cp.phone), ''), b.notes,
         gp.full_name, b.assignment_pending, b.gardener_finished_at, public.booking_service_start(b),
         -- Las horas del empleado el primer día del trabajo (lo de F6; en varios días, my_days).
         (SELECT array_agg(bb.hour_block ORDER BY bb.hour_block) FROM public.booking_blocks bb
          WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid() AND bb.date = b.date),
         b.end_date, b.labour_hours,
         (SELECT count(DISTINCT bb.assignee_id)::integer FROM public.booking_blocks bb WHERE bb.booking_id = b.id),
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object('date', d.date, 'hours', d.hours) ORDER BY d.date)
           FROM (
             SELECT bb.date, array_agg(bb.hour_block ORDER BY bb.hour_block) AS hours
             FROM public.booking_blocks bb
             WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid()
             GROUP BY bb.date
           ) d
         ), '[]'::jsonb)
  FROM public.bookings b
  JOIN public.services s ON s.id = b.service_id
  JOIN public.gardener_profiles gp ON gp.user_id = b.gardener_id
  LEFT JOIN public.profiles cp ON cp.user_id = b.client_id
  WHERE b.date <= p_to AND COALESCE(b.end_date, b.date) >= p_from
    AND b.status IN ('pending', 'confirmed', 'in_progress', 'completed', 'disputed')
    AND EXISTS (SELECT 1 FROM public.booking_blocks bb WHERE bb.booking_id = b.id AND bb.assignee_id = auth.uid())
  ORDER BY b.date, b.start_time;
$function$;

CREATE OR REPLACE FUNCTION public.trg_booking_chat_system_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gardener text;
  v_service  text;
  v_when     text;
  v_price    text;
  v_proposed text;
BEGIN
  v_gardener := public.chat_display_name(NEW.gardener_id, 'El profesional');
  v_service := COALESCE(public.booking_service_label(NEW.id), 'el servicio');
  v_when  := to_char(NEW.date, 'DD/MM/YYYY') || COALESCE(' a las ' || to_char(NEW.start_time, 'HH24:MI'), '');
  v_price := public.format_eur(COALESCE(NEW.total_price, 0));

  -- Alta de reserva (solicitud). Solo para reservas reales, no estados intermedios.
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('pending', 'confirmed') THEN
      PERFORM public.post_booking_system_message(
        NEW.id,
        'Reserva solicitada: ' || v_service || ' para el ' || v_when ||
        '. Precio del servicio: ' || v_price || ', que el cliente abona al profesional al completarlo.' ||
        ' A la espera de que el profesional la confirme.'
      );
    END IF;
    RETURN NEW;
  END IF;

  -- Cambios de estado de la reserva
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'confirmed' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, v_gardener || ' ha aceptado la reserva. ¡Todo listo para el ' || v_when || '!'
      );

    ELSIF NEW.status = 'completed' THEN
      -- El chat lo leen las DOS partes, asi que el texto tiene que ser correcto para ambas: se
      -- afirma el hecho (servicio finalizado) y se invita a valorar nombrando a quien puede
      -- hacerlo. Sin esto el cliente no tenia forma de saber que se esperaba algo de el.
      PERFORM public.post_booking_system_message(
        NEW.id,
        'Servicio finalizado: ' || v_service || ' del ' || v_when || '.' ||
        ' El cliente puede dejar ahora su valoración de ' || v_gardener ||
        ' desde «Mis reservas» o desde el apartado de reseñas.'
      );

    ELSIF NEW.status IN ('cancelled', 'rejected') THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'La reserva de ' || v_service || ' ha sido cancelada.'
      );
    END IF;
  END IF;

  -- Cambios de precio del servicio
  IF NEW.price_change_status IS DISTINCT FROM OLD.price_change_status THEN
    IF NEW.price_change_status = 'pending_client_acceptance' THEN
      v_proposed := public.format_eur(COALESCE(NEW.proposed_total_price, 0));
      PERFORM public.post_booking_system_message(
        NEW.id,
        v_gardener || ' propone un nuevo precio del servicio: ' || v_proposed ||
        COALESCE('. Motivo: ' || NULLIF(TRIM(NEW.proposed_price_reason), ''), '') ||
        '. Los gastos de gestión ya abonados no cambian. Puedes aceptarlo o rechazarlo desde el chat.'
      );
    ELSIF NEW.price_change_status = 'accepted' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'Nuevo precio del servicio aceptado: ' || v_price || '.'
      );
    ELSIF NEW.price_change_status = 'rejected' THEN
      PERFORM public.post_booking_system_message(
        NEW.id, 'Propuesta de nuevo precio rechazada. Se mantiene el precio del servicio: ' || v_price || '.'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
