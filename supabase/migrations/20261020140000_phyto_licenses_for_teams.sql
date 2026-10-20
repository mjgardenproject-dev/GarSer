-- Carnet fitosanitario de los empleados (2026-10-20).
--
-- El carnet es de cada persona (D4): lo sube el propio empleado o, con su permiso, el dueño de la
-- empresa en su nombre (decisión del usuario, 2026-10-20). Esta migración cierra lo que faltaba:
--
-- 1. Una sola vía para enviar un carnet: `submit_phyto_license`. Comprueba quién lo envía y para
--    quién, que el archivo existe, lo subió quien llama y está en la carpeta del titular, la
--    declaración responsable y un límite de envíos. La web ya no escribe en la tabla:
--    - antes una licencia podía apuntar al documento de otra persona;
--    - mientras estaba en revisión, el titular podía cambiar cualquier campo.
-- 2. Renovar ya no quita el carnet vigente. Antes, subir uno nuevo marcaba el aprobado como
--    «replaced» y ponía la ficha del autónomo en «pending»: dejaba de salir en los tratamientos
--    químicos y, en empresa, se le quitaban los fitosanitarios. Ahora el aprobado vale hasta que se
--    aprueba el nuevo, y si el nuevo se rechaza, el vigente sigue.
-- 3. La ficha del autónomo (lo que mira booking-authority) se calcula siempre del estado real de
--    sus carnets, con un trigger, en vez de escribirla a mano en cada función.
-- 4. Rechazo con motivo, que ve el titular (y la empresa, si es un empleado).
-- 5. Avisos (correo y móvil, por la cola): revisión, carnet enviado por la empresa, «tu empresa te
--    pide el carnet», 30 días antes de caducar y al caducar. Al dueño, lo de sus empleados.
-- 6. La empresa ve de cada persona el estado, la caducidad y el motivo (nunca el documento) y
--    puede pedirle el carnet. El empleado ve su carnet aunque la empresa aún no haga tratamientos.
-- 7. El almacén solo admite PDF, JPG o PNG de hasta 10 MB.

-- =============================================
-- 1) Columnas
-- =============================================
ALTER TABLE public.gardener_licenses
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.gardener_licenses DROP CONSTRAINT IF EXISTS gardener_licenses_rejection_reason_length;
ALTER TABLE public.gardener_licenses
  ADD CONSTRAINT gardener_licenses_rejection_reason_length CHECK (rejection_reason IS NULL OR char_length(rejection_reason) <= 300);

CREATE INDEX IF NOT EXISTS gardener_licenses_holder_created_idx ON public.gardener_licenses (gardener_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gardener_licenses_pending_idx ON public.gardener_licenses (created_at) WHERE status = 'pending';

COMMENT ON COLUMN public.gardener_licenses.gardener_id IS 'Titular del carnet: autónomo, dueño de empresa o empleado.';
COMMENT ON COLUMN public.gardener_licenses.submitted_by IS 'Quién lo envió: el titular o el dueño de su empresa en su nombre.';
COMMENT ON COLUMN public.gardener_licenses.rejection_reason IS 'Motivo del rechazo, que ve el titular.';

-- Cuándo pidió la empresa el carnet a esa persona (para no repetir el aviso y para enseñarlo).
ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS phyto_license_requested_at timestamptz;

-- =============================================
-- 2) Estado real del carnet de una persona (una sola fuente)
-- =============================================
-- `status`: approved (con uno vigente), pending, rejected, expired o null (nunca subió ninguno).
-- `renewal`: con uno vigente, el nuevo que está en revisión o se rechazó.
CREATE OR REPLACE FUNCTION private.phyto_license_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH valid AS (
    SELECT l.* FROM public.gardener_licenses l
    WHERE l.gardener_id = p_user_id AND l.status = 'approved' AND l.expires_at > now()
    ORDER BY l.expires_at DESC
    LIMIT 1
  ), latest AS (
    SELECT l.*,
      CASE WHEN l.status = 'approved' AND (l.expires_at IS NULL OR l.expires_at <= now()) THEN 'expired' ELSE l.status END AS effective
    FROM public.gardener_licenses l
    WHERE l.gardener_id = p_user_id AND l.status <> 'replaced'
    ORDER BY l.created_at DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM valid) THEN (
      SELECT jsonb_build_object(
        'status', 'approved',
        'active', true,
        'expires_at', v.expires_at,
        'reviewed_at', v.reviewed_at,
        'submitted_at', v.created_at,
        'license_number', v.license_number,
        'rejection_reason', NULL,
        'renewal', (
          SELECT jsonb_build_object(
            'status', la.status,
            'submitted_at', la.created_at,
            'rejection_reason', la.rejection_reason,
            'submitted_by_company', la.submitted_by IS NOT NULL AND la.submitted_by <> la.gardener_id
          )
          FROM latest la
          WHERE la.id <> v.id AND la.status IN ('pending', 'rejected')
        )
      )
      FROM valid v
    )
    WHEN EXISTS (SELECT 1 FROM latest) THEN (
      SELECT jsonb_build_object(
        'status', la.effective,
        'active', false,
        'expires_at', CASE WHEN la.effective = 'expired' THEN la.expires_at END,
        'reviewed_at', la.reviewed_at,
        'submitted_at', la.created_at,
        'license_number', la.license_number,
        'rejection_reason', CASE WHEN la.status = 'rejected' THEN la.rejection_reason END,
        'submitted_by_company', la.submitted_by IS NOT NULL AND la.submitted_by <> la.gardener_id,
        'renewal', NULL
      )
      FROM latest la
    )
    ELSE jsonb_build_object('status', NULL, 'active', false, 'renewal', NULL)
  END;
$$;
REVOKE ALL ON FUNCTION private.phyto_license_summary(uuid) FROM PUBLIC, anon, authenticated;

-- El estado que ya usaban «Completa tu cuenta» y el equipo: ahora el real (un carnet vigente
-- manda aunque haya una renovación en revisión).
CREATE OR REPLACE FUNCTION public.latest_phyto_license_status(p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT private.phyto_license_summary(p_user_id) ->> 'status';
$$;

-- =============================================
-- 3) La ficha del autónomo, siempre del estado real
-- =============================================
-- booking-authority decide con `license_verification_status` y `license_expires_at` de la ficha.
CREATE OR REPLACE FUNCTION private.sync_provider_license_flags(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_summary jsonb := private.phyto_license_summary(p_user_id);
  v_active boolean := COALESCE((v_summary ->> 'active')::boolean, false);
  v_status text := v_summary ->> 'status';
  v_verified timestamptz := CASE WHEN v_active THEN (v_summary ->> 'reviewed_at')::timestamptz END;
  v_expires timestamptz := CASE WHEN v_status IN ('approved', 'expired') THEN (v_summary ->> 'expires_at')::timestamptz END;
BEGIN
  UPDATE public.gardener_profiles gp
  SET has_phytosanitary_license = v_active,
      license_verification_status = v_status,
      license_verified_at = v_verified,
      license_expires_at = v_expires
  WHERE gp.user_id = p_user_id
    AND (gp.has_phytosanitary_license, gp.license_verification_status, gp.license_verified_at, gp.license_expires_at)
        IS DISTINCT FROM (v_active, v_status, v_verified, v_expires);
END;
$$;
REVOKE ALL ON FUNCTION private.sync_provider_license_flags(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.gardener_licenses_sync_flags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.sync_provider_license_flags(NEW.gardener_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gardener_licenses_sync_flags ON public.gardener_licenses;
CREATE TRIGGER trg_gardener_licenses_sync_flags
  AFTER INSERT OR UPDATE OF status, expires_at ON public.gardener_licenses
  FOR EACH ROW
  EXECUTE FUNCTION private.gardener_licenses_sync_flags();

-- Al enviar uno nuevo se retiran los anteriores que no valen (en revisión, rechazados, caducados).
-- El aprobado y vigente se queda hasta que se apruebe el nuevo.
CREATE OR REPLACE FUNCTION public.handle_new_gardener_license()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.gardener_licenses
  SET status = 'replaced'
  WHERE gardener_id = NEW.gardener_id
    AND id <> NEW.id
    AND (status IN ('pending', 'rejected', 'expired')
         OR (status = 'approved' AND (expires_at IS NULL OR expires_at <= now())));
  RETURN NEW;
END;
$$;

-- =============================================
-- 4) Avisos
-- =============================================
-- Al titular (`phyto_license_update`) y, si es empleado de una empresa, al dueño
-- (`member_phyto_license_update`). Eventos: approved, rejected, expiring, expired y, solo al
-- titular, submitted_for_you (la empresa ha enviado su carnet).
CREATE OR REPLACE FUNCTION private.notify_phyto_license_event(p_license_id uuid, p_event text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_holder uuid;
  v_member uuid;
BEGIN
  SELECT gardener_id INTO v_holder FROM public.gardener_licenses WHERE id = p_license_id;
  IF v_holder IS NULL THEN
    RETURN;
  END IF;
  PERFORM private.enqueue_notification('phyto_license_update',
    format('phyto_license_update:%s:%s', p_license_id, p_event), NULL,
    jsonb_build_object('licenseId', p_license_id, 'event', p_event));
  IF p_event = 'submitted_for_you' THEN
    RETURN;
  END IF;
  SELECT m.id INTO v_member FROM public.company_members m
  WHERE m.user_id = v_holder AND m.role = 'employee' AND m.status = 'active'
  LIMIT 1;
  IF v_member IS NOT NULL THEN
    PERFORM private.enqueue_notification('member_phyto_license_update',
      format('member_phyto_license_update:%s:%s', p_license_id, p_event), NULL,
      jsonb_build_object('licenseId', p_license_id, 'memberId', v_member, 'event', p_event));
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.notify_phyto_license_event(uuid, text) FROM PUBLIC, anon, authenticated;

-- =============================================
-- 5) Enviar un carnet (el titular, o el dueño por alguien de su equipo)
-- =============================================
-- ¿Puede quien llama subir un carnet a esa carpeta del almacén? La suya (si es profesional o de un
-- equipo) o la de un empleado activo de su empresa. Lo usa la política del almacén.
CREATE OR REPLACE FUNCTION public.can_upload_phyto_license_to(p_folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    (p_folder = auth.uid()::text
      AND (EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = auth.uid()) OR public.my_company_id() IS NOT NULL))
    OR EXISTS (
      SELECT 1 FROM public.company_members m
      WHERE m.user_id::text = p_folder AND m.role = 'employee' AND m.status = 'active'
        AND public.is_company_owner(m.company_id)
    )
  );
$$;
REVOKE ALL ON FUNCTION public.can_upload_phyto_license_to(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_upload_phyto_license_to(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_phyto_license(
  p_document_path text,
  p_declaration boolean,
  p_license_number text DEFAULT NULL,
  p_document_hash text DEFAULT NULL,
  p_member_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_holder uuid;
  v_member public.company_members%ROWTYPE;
  v_path text := btrim(COALESCE(p_document_path, ''));
  v_number text := NULLIF(btrim(COALESCE(p_license_number, '')), '');
  v_hash text := NULLIF(lower(btrim(COALESCE(p_document_hash, ''))), '');
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión.' USING ERRCODE = '42501';
  END IF;

  IF p_member_id IS NULL THEN
    v_holder := v_uid;
    IF NOT EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_uid) AND public.my_company_id() IS NULL THEN
      RAISE EXCEPTION 'Solo los profesionales y sus equipos pueden enviar un carnet.' USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT * INTO v_member FROM public.company_members WHERE id = p_member_id;
    IF NOT FOUND OR NOT public.is_company_owner(v_member.company_id) THEN
      RAISE EXCEPTION 'Solo el dueño de la empresa puede enviar el carnet de alguien de su equipo.' USING ERRCODE = '42501';
    END IF;
    IF v_member.status <> 'active' OR v_member.role <> 'employee' THEN
      RAISE EXCEPTION 'Esta persona ya no forma parte de tu equipo.' USING ERRCODE = '22023';
    END IF;
    v_holder := v_member.user_id;
  END IF;

  IF NOT COALESCE(p_declaration, false) THEN
    RAISE EXCEPTION 'Hace falta aceptar la declaración responsable.' USING ERRCODE = '22023';
  END IF;
  IF v_number IS NOT NULL AND char_length(v_number) > 40 THEN
    RAISE EXCEPTION 'El número de carnet es demasiado largo (máximo 40 caracteres).' USING ERRCODE = '22023';
  END IF;
  IF v_hash IS NOT NULL AND v_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'La huella del documento no es válida.' USING ERRCODE = '22023';
  END IF;

  -- El archivo: en la carpeta del titular, con un nombre normal, subido por quien llama y sin usar.
  IF v_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[A-Za-z0-9_-]{1,100}\.(pdf|jpg|jpeg|png)$'
     OR split_part(v_path, '/', 1) <> v_holder::text THEN
    RAISE EXCEPTION 'El documento no es válido.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects o
    WHERE o.bucket_id = 'private_licenses' AND o.name = v_path AND o.owner_id = v_uid::text
  ) THEN
    RAISE EXCEPTION 'No encontramos el documento subido. Vuelve a intentarlo.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.gardener_licenses WHERE document_url = v_path) THEN
    RAISE EXCEPTION 'Ese documento ya se envió.' USING ERRCODE = '22023';
  END IF;

  -- Límite: 5 envíos por persona al día (un error al elegir el archivo no debería bloquear a nadie).
  PERFORM 1 FROM public.gardener_licenses WHERE gardener_id = v_holder FOR UPDATE;
  IF (SELECT count(*) FROM public.gardener_licenses WHERE gardener_id = v_holder AND created_at > now() - interval '24 hours') >= 5 THEN
    RAISE EXCEPTION 'Se han enviado demasiados carnets hoy. Vuelve a intentarlo mañana.' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.gardener_licenses (
    gardener_id, license_number, document_url, status, terms_accepted, terms_accepted_at, document_hash, submitted_by
  ) VALUES (
    v_holder, v_number, v_path, 'pending', true, now(), v_hash, v_uid
  )
  RETURNING id INTO v_id;

  IF v_holder <> v_uid THEN
    PERFORM private.notify_phyto_license_event(v_id, 'submitted_for_you');
  END IF;

  RETURN jsonb_build_object('licenseId', v_id, 'status', 'pending', 'holderId', v_holder);
END;
$$;
REVOKE ALL ON FUNCTION public.submit_phyto_license(text, boolean, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_phyto_license(text, boolean, text, text, uuid) TO authenticated, service_role;

-- =============================================
-- 6) Nadie escribe la tabla desde la web
-- =============================================
DROP POLICY IF EXISTS "Gardeners can insert own licenses" ON public.gardener_licenses;
DROP POLICY IF EXISTS "Gardeners can update own license number" ON public.gardener_licenses;
DROP POLICY IF EXISTS "Admins can update licenses" ON public.gardener_licenses;
REVOKE ALL ON TABLE public.gardener_licenses FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.gardener_licenses FROM authenticated;
GRANT SELECT ON TABLE public.gardener_licenses TO authenticated;
GRANT ALL ON TABLE public.gardener_licenses TO service_role;

-- =============================================
-- 7) El almacén
-- =============================================
UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png']
WHERE id = 'private_licenses';

DROP POLICY IF EXISTS "Gardeners can upload own licenses" ON storage.objects;
DROP POLICY IF EXISTS "Licenses: upload own or team member" ON storage.objects;
CREATE POLICY "Licenses: upload own or team member" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'private_licenses' AND public.can_upload_phyto_license_to((storage.foldername(name))[1]));

-- =============================================
-- 8) Revisión del admin, con motivo
-- =============================================
DROP FUNCTION IF EXISTS public.review_gardener_license(uuid, text, timestamptz);
CREATE OR REPLACE FUNCTION public.review_gardener_license(
  p_license_id uuid,
  p_status text,
  p_expires_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license public.gardener_licenses%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede revisar licencias' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Desenlace no válido: % (solo approved o rejected)', p_status USING ERRCODE = '22023';
  END IF;
  -- D1: la caducidad la escribe el admin antes de aprobar. Un carnet dura 10 años: más de 15 es
  -- un error al escribir la fecha.
  IF p_status = 'approved' AND (p_expires_at IS NULL OR p_expires_at <= now() OR p_expires_at > now() + interval '15 years') THEN
    RAISE EXCEPTION 'Para aprobar hace falta una fecha de caducidad futura (y no más de 15 años).' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'rejected' AND (v_reason IS NULL OR char_length(v_reason) < 3 OR char_length(v_reason) > 300) THEN
    RAISE EXCEPTION 'Para rechazar hace falta el motivo (lo verá quien lo envió).' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_license FROM public.gardener_licenses WHERE id = p_license_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Licencia no encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF v_license.status <> 'pending' THEN
    RAISE EXCEPTION 'Este carnet ya no está pendiente de revisión.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.gardener_licenses
  SET status = p_status,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      expires_at = CASE WHEN p_status = 'approved' THEN p_expires_at ELSE NULL END,
      rejection_reason = CASE WHEN p_status = 'rejected' THEN v_reason ELSE NULL END
  WHERE id = p_license_id;

  -- Aprobado el nuevo, el anterior deja de contar (ya hay uno vigente: no se retira ningún servicio).
  IF p_status = 'approved' THEN
    UPDATE public.gardener_licenses
    SET status = 'replaced'
    WHERE gardener_id = v_license.gardener_id AND id <> p_license_id AND status IN ('approved', 'expired');
  END IF;

  PERFORM private.notify_phyto_license_event(p_license_id, p_status);

  RETURN jsonb_build_object(
    'licenseId', p_license_id,
    'gardenerId', v_license.gardener_id,
    'status', p_status,
    'expiresAt', CASE WHEN p_status = 'approved' THEN p_expires_at END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.review_gardener_license(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_gardener_license(uuid, text, timestamptz, text) TO authenticated, service_role;

-- La cola del admin: quién es (autónomo, empresa o empleado de qué empresa), si es una renovación
-- y si lo envió la empresa. Antes la armaba el navegador con cinco consultas.
CREATE OR REPLACE FUNCTION public.admin_phyto_license_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acceso denegado: el usuario no es administrador.' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(q.row_data ORDER BY q.created_at)
    FROM (
      SELECT l.created_at, jsonb_build_object(
        'id', l.id,
        'holder_id', l.gardener_id,
        'created_at', l.created_at,
        'license_number', l.license_number,
        'document_url', l.document_url,
        'document_hash', l.document_hash,
        'holder_name', COALESCE(NULLIF(BTRIM(pr.full_name), ''), NULLIF(BTRIM(gp.full_name), ''), u.email),
        'email', u.email,
        'phone', COALESCE(NULLIF(BTRIM(gp.phone), ''), NULLIF(BTRIM(pr.phone), '')),
        'holder_kind', CASE
          WHEN em.id IS NOT NULL THEN 'employee'
          WHEN gp.provider_kind = 'company' THEN 'company_owner'
          ELSE 'solo'
        END,
        'company_name', COALESCE(ec.full_name, CASE WHEN gp.provider_kind = 'company' THEN gp.full_name END),
        'submitted_by_company', l.submitted_by IS NOT NULL AND l.submitted_by <> l.gardener_id,
        'current_expires_at', (
          SELECT max(v.expires_at) FROM public.gardener_licenses v
          WHERE v.gardener_id = l.gardener_id AND v.status = 'approved' AND v.expires_at > now()
        ),
        'previous_rejections', (
          SELECT count(*) FROM public.gardener_licenses r
          WHERE r.gardener_id = l.gardener_id AND r.id <> l.id AND r.rejection_reason IS NOT NULL
        )
      ) AS row_data
      FROM public.gardener_licenses l
      JOIN auth.users u ON u.id = l.gardener_id
      LEFT JOIN public.gardener_profiles gp ON gp.user_id = l.gardener_id
      LEFT JOIN public.profiles pr ON pr.user_id = l.gardener_id
      LEFT JOIN LATERAL (
        SELECT m.id, m.company_id FROM public.company_members m
        WHERE m.user_id = l.gardener_id AND m.role = 'employee' AND m.status = 'active'
        LIMIT 1
      ) em ON true
      LEFT JOIN public.companies c ON c.id = em.company_id
      LEFT JOIN public.gardener_profiles ec ON ec.user_id = c.provider_user_id
      WHERE l.status = 'pending'
    ) q
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_phyto_license_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_phyto_license_queue() TO authenticated, service_role;

-- =============================================
-- 9) Caducidad: aviso 30 días antes y al caducar
-- =============================================
-- La llama booking-lifecycle-tick en cada vuelta. Los avisos no se repiten (clave por carnet).
CREATE OR REPLACE FUNCTION public.expire_due_phytosanitary_licenses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  r record;
BEGIN
  -- Avisa 30 días antes, salvo que ya haya enviado otro (en revisión o aprobado más largo).
  FOR r IN
    SELECT l.id FROM public.gardener_licenses l
    WHERE l.status = 'approved' AND l.expires_at > now() AND l.expires_at <= now() + interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM public.gardener_licenses n
        WHERE n.gardener_id = l.gardener_id AND n.id <> l.id
          AND (n.status = 'pending' OR (n.status = 'approved' AND n.expires_at > l.expires_at))
      )
  LOOP
    PERFORM private.notify_phyto_license_event(r.id, 'expiring');
  END LOOP;

  -- Caduca los vencidos. La ficha del autónomo y los servicios del empleado los ajustan sus triggers.
  FOR r IN
    UPDATE public.gardener_licenses
    SET status = 'expired'
    WHERE status = 'approved' AND expires_at IS NOT NULL AND expires_at <= now()
    RETURNING id, gardener_id
  LOOP
    v_count := v_count + 1;
    IF NOT public.has_valid_phyto_license(r.gardener_id) THEN
      PERFORM private.notify_phyto_license_event(r.id, 'expired');
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.expire_due_phytosanitary_licenses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_phytosanitary_licenses() TO service_role;

-- =============================================
-- 10) La empresa pide el carnet a alguien de su equipo
-- =============================================
CREATE OR REPLACE FUNCTION public.request_member_phyto_license(p_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.company_members%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_member FROM public.company_members WHERE id = p_member_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_company_owner(v_member.company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede pedir el carnet a su equipo.' USING ERRCODE = '42501';
  END IF;
  IF v_member.status <> 'active' OR v_member.role <> 'employee' THEN
    RAISE EXCEPTION 'Esta persona ya no forma parte de tu equipo.' USING ERRCODE = '22023';
  END IF;
  v_status := public.latest_phyto_license_status(v_member.user_id);
  IF public.has_valid_phyto_license(v_member.user_id) THEN
    RAISE EXCEPTION 'Ya tiene su carnet aprobado.' USING ERRCODE = '22023';
  END IF;
  IF v_status = 'pending' THEN
    RAISE EXCEPTION 'Su carnet ya está en revisión.' USING ERRCODE = '22023';
  END IF;
  IF v_member.phyto_license_requested_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Ya se lo has pedido hoy. Podrás volver a pedírselo mañana.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.company_members SET phyto_license_requested_at = now() WHERE id = p_member_id;
  PERFORM private.enqueue_notification('phyto_license_requested',
    format('phyto_license_requested:%s:%s', p_member_id, private.notification_stamp(now())), NULL,
    jsonb_build_object('memberId', p_member_id));

  RETURN jsonb_build_object('member_id', p_member_id, 'requested_at', now());
END;
$$;
REVOKE ALL ON FUNCTION public.request_member_phyto_license(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_member_phyto_license(uuid) TO authenticated, service_role;

-- =============================================
-- 11) Lo que ve el empleado y lo que ve la empresa
-- =============================================
-- ¿La empresa hace algo que pide carnet? Fitosanitarios, o desbroce con herbicida.
CREATE OR REPLACE FUNCTION private.provider_offers_chemical(p_provider uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gardener_service_prices p JOIN public.services s ON s.id = p.service_id
    WHERE p.gardener_id = p_provider AND p.active
      AND (s.name = 'Servicios fitosanitarios'
           OR (s.name = 'Desbroce de malas hierbas' AND COALESCE(public.safe_numeric(p.additional_config ->> 'precio_herbicida_m2'), 0) > 0))
  );
$$;
REVOKE ALL ON FUNCTION private.provider_offers_chemical(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_company_membership()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'member_id', m.id,
    'role', m.role,
    'company_name', gp.full_name,
    'joined_at', m.joined_at,
    'company_offers_phyto', EXISTS (
      SELECT 1 FROM public.gardener_service_prices p JOIN public.services s ON s.id = p.service_id
      WHERE p.gardener_id = c.provider_user_id AND p.active AND s.name = 'Servicios fitosanitarios'
    ),
    -- Se le pide el carnet si la empresa hace tratamientos químicos o se lo ha pedido.
    'license_needed', private.provider_offers_chemical(c.provider_user_id) OR m.phyto_license_requested_at IS NOT NULL,
    'license_requested_at', m.phyto_license_requested_at,
    'license', private.phyto_license_summary(m.user_id),
    'services', COALESCE((
      SELECT jsonb_agg(s.name ORDER BY s.name)
      FROM public.company_member_services cms JOIN public.services s ON s.id = cms.service_id
      WHERE cms.member_id = m.id
    ), '[]'::jsonb)
  )
  FROM public.company_members m
  JOIN public.companies c ON c.id = m.company_id
  JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
  WHERE m.user_id = auth.uid() AND m.status = 'active';
$$;

-- El equipo: de cada persona, el estado real de su carnet, la caducidad, el motivo si se rechazó
-- y cuándo se le pidió. Nunca el documento ni el número.
CREATE OR REPLACE FUNCTION public.company_team_overview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
  v_provider uuid;
BEGIN
  IF v_company_id IS NULL OR NOT public.is_company_owner(v_company_id) THEN
    RAISE EXCEPTION 'Solo el dueño de la empresa puede ver su equipo.';
  END IF;

  SELECT provider_user_id INTO v_provider FROM public.companies WHERE id = v_company_id;

  RETURN jsonb_build_object(
    'company', (
      SELECT jsonb_build_object(
        'id', c.id, 'legal_name', c.legal_name, 'tax_id', c.tax_id, 'status', c.status,
        'assignment_mode', c.assignment_mode,
        'allow_split_jobs', c.allow_split_jobs,
        'max_crew', c.max_crew,
        'commercial_name', gp.full_name, 'phone', gp.phone, 'address', gp.address
      )
      FROM public.companies c JOIN public.gardener_profiles gp ON gp.user_id = c.provider_user_id
      WHERE c.id = v_company_id
    ),
    'offered_services', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
      FROM public.gardener_service_prices p JOIN public.services s ON s.id = p.service_id
      WHERE p.gardener_id = v_provider AND p.active
    ), '[]'::jsonb),
    'offers_chemical', private.provider_offers_chemical(v_provider),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'member_id', m.id,
        'user_id', m.user_id,
        'role', m.role,
        'status', m.status,
        'counts_as_labour', m.counts_as_labour,
        'joined_at', m.joined_at,
        'full_name', NULLIF(BTRIM(pr.full_name), ''),
        'phone', NULLIF(BTRIM(pr.phone), ''),
        'email', u.email,
        'services', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
          FROM public.company_member_services cms JOIN public.services s ON s.id = cms.service_id
          WHERE cms.member_id = m.id
        ), '[]'::jsonb),
        'license_status', lic.summary ->> 'status',
        'license_expires_at', lic.summary -> 'expires_at',
        'license_rejection_reason', lic.summary -> 'rejection_reason',
        'license_renewal', lic.summary -> 'renewal',
        'license_requested_at', m.phyto_license_requested_at,
        'has_valid_phyto_license', COALESCE((lic.summary ->> 'active')::boolean, false),
        -- R-04: lo que le falta para poder recibir trabajos (horario fijo y algún servicio).
        'has_recurring_schedule', EXISTS (SELECT 1 FROM public.recurring_schedules rs WHERE rs.gardener_id = m.user_id),
        'is_configured', EXISTS (SELECT 1 FROM public.recurring_schedules rs WHERE rs.gardener_id = m.user_id)
                         AND EXISTS (SELECT 1 FROM public.company_member_services cms WHERE cms.member_id = m.id)
      ) ORDER BY (m.role = 'owner') DESC, m.status, m.joined_at)
      FROM public.company_members m
      JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles pr ON pr.user_id = m.user_id
      CROSS JOIN LATERAL (SELECT private.phyto_license_summary(m.user_id) AS summary) lic
      WHERE m.company_id = v_company_id
    ), '[]'::jsonb),
    'invitations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'email', i.email, 'created_at', i.created_at, 'expires_at', i.expires_at
      ) ORDER BY i.created_at DESC)
      FROM public.company_invitations i
      WHERE i.company_id = v_company_id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
    ), '[]'::jsonb)
  );
END;
$$;

-- =============================================
-- 12) Fichas al día
-- =============================================
-- Una pasada para dejar la ficha de cada profesional igual que el estado real de sus carnets.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT DISTINCT gardener_id FROM public.gardener_licenses WHERE gardener_id IS NOT NULL LOOP
    PERFORM private.sync_provider_license_flags(r.gardener_id);
  END LOOP;
END;
$$;
