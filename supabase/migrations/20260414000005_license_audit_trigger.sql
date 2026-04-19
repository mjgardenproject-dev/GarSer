-- Migración: Trazabilidad inmutable de cambios de estado en carnés fitosanitarios
-- Objetivo: Cualquier UPDATE en la tabla gardener_licenses quedará registrado en admin_audit_logs automáticamente.

-- 1. Crear la función del trigger
CREATE OR REPLACE FUNCTION public.log_license_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo registramos si el estado ha cambiado (por ejemplo, de pending a approved/rejected)
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO public.admin_audit_logs (
            admin_id,
            action_type,
            target_table,
            target_id,
            old_data,
            new_data,
            created_at
        ) VALUES (
            -- Asumimos que el admin que hace el cambio queda registrado en NEW.reviewed_by. 
            -- Si es nulo (por ejemplo, un cambio de estado automático o de sistema), usamos el uid() actual si existe.
            COALESCE(NEW.reviewed_by, auth.uid()), 
            'UPDATE_LICENSE_STATUS',
            'gardener_licenses',
            NEW.id,
            jsonb_build_object('status', OLD.status),
            jsonb_build_object('status', NEW.status, 'reviewed_at', NEW.reviewed_at),
            NOW()
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Asegurar que no hay triggers duplicados y crearlo
DROP TRIGGER IF EXISTS on_license_status_change ON public.gardener_licenses;

CREATE TRIGGER on_license_status_change
    AFTER UPDATE ON public.gardener_licenses
    FOR EACH ROW
    EXECUTE FUNCTION public.log_license_status_change();
