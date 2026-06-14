-- ==============================================================================
-- CTO ARCHITECTURE DECISION: SECURE ADMIN PROVISIONING
-- ==============================================================================
-- REGLA ESTRICTA: NUNCA se insertan usuarios, contraseñas o hashes manualmente 
-- en auth.users mediante SQL. Esto rompe la seguridad de GoTrue, el manejo de 
-- sesiones y las políticas de MFA.
--
-- SOLUCIÓN: Este trigger escucha la creación de usuarios gestionada por Supabase 
-- Auth. Si el email coincide estrictamente con el correo corporativo autorizado,
-- le asigna o crea su perfil con el rol 'admin' de forma automatizada y segura.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.auto_provision_corporate_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER -- Ejecuta con privilegios elevados para poder escribir en profiles
AS $$
BEGIN
  -- 1. Verificación estricta del correo corporativo autorizado
  IF NEW.email = 'mjgardenproject@gmail.com' THEN
    
    -- 2. Upsert seguro evitando triggers de bloqueo (prevent_duplicate_profiles)
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = NEW.id) THEN
      UPDATE public.profiles 
      SET role = 'admin', updated_at = now()
      WHERE user_id = NEW.id;
    ELSE
      INSERT INTO public.profiles (user_id, role, created_at, updated_at)
      VALUES (NEW.id, 'admin', now(), now());
    END IF;
    
  END IF;
  
  RETURN NEW;
END;
$$;

-- 3. Vincular el trigger a auth.users de forma idempotente
DROP TRIGGER IF EXISTS trg_provision_admin ON auth.users;
CREATE TRIGGER trg_provision_admin
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_provision_corporate_admin();

-- ==============================================================================
-- RETROACTIVIDAD: Si la cuenta ya fue creada manualmente desde el Dashboard
-- antes de aplicar esta migración, aplicamos la elevación de privilegios ahora.
-- ==============================================================================
DO $$
DECLARE
  v_admin_id uuid;
BEGIN
  -- Buscar al usuario en la tabla segura del sistema
  SELECT id INTO v_admin_id FROM auth.users WHERE email = 'mjgardenproject@gmail.com' LIMIT 1;
  
  IF v_admin_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_admin_id) THEN
      UPDATE public.profiles 
      SET role = 'admin', updated_at = now()
      WHERE user_id = v_admin_id;
    ELSE
      INSERT INTO public.profiles (user_id, role, created_at, updated_at)
      VALUES (v_admin_id, 'admin', now(), now());
    END IF;
  END IF;
END $$;
