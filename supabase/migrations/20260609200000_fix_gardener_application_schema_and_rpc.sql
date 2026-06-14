-- 1. Añadir 'other_services' a 'gardener_profiles' si no existe
ALTER TABLE public.gardener_profiles
ADD COLUMN IF NOT EXISTS other_services text;

-- 2. Trigger en 'profiles' para evitar que un usuario normal modifique su propio 'role'
CREATE OR REPLACE FUNCTION public.check_profile_role_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el rol no cambia, permitir la actualización
  IF NEW.role = OLD.role THEN
    RETURN NEW;
  END IF;

  -- Permitir si se está ejecutando en un contexto de sistema sin sesión
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Permitir si el usuario que realiza la acción es admin
  IF EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RETURN NEW;
  END IF;

  -- Rechazar el cambio de rol
  RAISE EXCEPTION 'No tienes permisos para modificar el rol.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS prevent_role_escalation ON public.profiles;
CREATE TRIGGER prevent_role_escalation
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_profile_role_update();

-- 3. Crear RPC 'admin_review_gardener_application'
CREATE OR REPLACE FUNCTION public.admin_review_gardener_application(
  p_application_id uuid,
  p_status text,
  p_comment text DEFAULT NULL
)
RETURNS void AS $$
DECLARE
  v_is_admin boolean;
  v_application record;
BEGIN
  -- Verificar que el usuario que llama a la función es administrador
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Acceso denegado: El usuario no es administrador.';
  END IF;

  -- Validar el estado
  IF p_status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Estado inválido. Debe ser "approved" o "rejected".';
  END IF;

  -- Obtener la solicitud
  SELECT * INTO v_application FROM public.gardener_applications WHERE id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada.';
  END IF;

  IF v_application.status != 'submitted' THEN
    RAISE EXCEPTION 'La solicitud no está en estado "submitted" (actual: %).', v_application.status;
  END IF;

  -- Actualizar la solicitud
  UPDATE public.gardener_applications
  SET 
    status = p_status,
    reviewer_id = auth.uid(),
    reviewed_at = now(),
    review_comment = p_comment,
    updated_at = now()
  WHERE id = p_application_id;

  -- Si es aprobada, actualizar perfiles
  IF p_status = 'approved' THEN
    
    -- Actualizar el rol en la tabla profiles
    UPDATE public.profiles
    SET role = 'gardener',
        updated_at = now()
    WHERE user_id = v_application.user_id;

    -- Upsert en gardener_profiles
    IF EXISTS (SELECT 1 FROM public.gardener_profiles WHERE user_id = v_application.user_id) THEN
      UPDATE public.gardener_profiles
      SET
        full_name = v_application.full_name,
        phone = v_application.phone,
        services = v_application.services,
        other_services = v_application.other_services,
        tools_available = v_application.tools_available,
        experience_years = v_application.experience_years,
        experience_range = v_application.experience_range,
        worked_for_companies = v_application.worked_for_companies,
        can_prove = v_application.can_prove,
        proof_photos = v_application.proof_photos,
        test_grass_frequency = v_application.test_grass_frequency,
        test_hedge_season = v_application.test_hedge_season,
        test_pest_action = v_application.test_pest_action,
        certification_text = v_application.certification_text,
        declaration_truth = v_application.declaration_truth,
        accept_terms = v_application.accept_terms,
        city_zone = v_application.city_zone,
        professional_photo_url = v_application.professional_photo_url,
        experience_description = v_application.experience_description,
        certification_photos = v_application.certification_photos,
        address = COALESCE(v_application.city_zone, address),
        updated_at = now()
      WHERE user_id = v_application.user_id;
    ELSE
      INSERT INTO public.gardener_profiles (
        user_id,
        full_name,
        phone,
        address,
        services,
        other_services,
        tools_available,
        experience_years,
        experience_range,
        worked_for_companies,
        can_prove,
        proof_photos,
        test_grass_frequency,
        test_hedge_season,
        test_pest_action,
        certification_text,
        declaration_truth,
        accept_terms,
        city_zone,
        professional_photo_url,
        experience_description,
        certification_photos
      )
      VALUES (
        v_application.user_id,
        v_application.full_name,
        v_application.phone,
        COALESCE(v_application.city_zone, ''),
        v_application.services,
        v_application.other_services,
        v_application.tools_available,
        v_application.experience_years,
        v_application.experience_range,
        v_application.worked_for_companies,
        v_application.can_prove,
        v_application.proof_photos,
        v_application.test_grass_frequency,
        v_application.test_hedge_season,
        v_application.test_pest_action,
        v_application.certification_text,
        v_application.declaration_truth,
        v_application.accept_terms,
        v_application.city_zone,
        v_application.professional_photo_url,
        v_application.experience_description,
        v_application.certification_photos
      );
    END IF;
  END IF;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.admin_review_gardener_application(uuid, text, text) TO authenticated;

-- 4. Notificar a PostgREST para recargar el esquema
NOTIFY pgrst, 'reload schema';
