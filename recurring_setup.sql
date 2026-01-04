-- Tabla para los horarios fijos (plantillas)
CREATE TABLE IF NOT EXISTS recurring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gardener_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Domingo, 1=Lunes...
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabla para configuración de disponibilidad recurrente
CREATE TABLE IF NOT EXISTS recurring_availability_settings (
  gardener_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weeks_to_maintain INT DEFAULT 2 CHECK (weeks_to_maintain BETWEEN 1 AND 12),
  last_generated_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Políticas de seguridad (RLS)
ALTER TABLE recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE recurring_availability_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own recurring schedules" ON recurring_schedules;
CREATE POLICY "Users can manage own recurring schedules" ON recurring_schedules
  USING (auth.uid() = gardener_id) WITH CHECK (auth.uid() = gardener_id);

DROP POLICY IF EXISTS "Users can manage own recurring settings" ON recurring_availability_settings;
CREATE POLICY "Users can manage own recurring settings" ON recurring_availability_settings
  USING (auth.uid() = gardener_id) WITH CHECK (auth.uid() = gardener_id);

-- Función para generar slots de disponibilidad basados en el horario fijo
CREATE OR REPLACE FUNCTION generate_recurring_slots(
  target_gardener_id UUID,
  force_regenerate BOOLEAN DEFAULT false
)
RETURNS VOID AS $$
DECLARE
  setting RECORD;
  rule RECORD;
  current_date_val DATE := CURRENT_DATE;
  start_date DATE;
  end_date DATE;
  iter_date DATE;
  day_idx INT;
  h INT;
  start_h INT;
  end_h INT;
BEGIN
  -- Obtener configuración
  SELECT * INTO setting FROM recurring_availability_settings WHERE gardener_id = target_gardener_id;
  
  -- Si no hay configuración, no hacemos nada
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Definir rango de fechas
  -- El rango siempre empieza "mañana" para no tocar el día en curso, a menos que sea force_regenerate
  -- Si es force_regenerate, reescribimos todo el periodo futuro configurado.
  -- Si NO es force_regenerate (mantenimiento diario), solo añadimos los días nuevos al final.
  
  end_date := current_date_val + (setting.weeks_to_maintain * 7);
  
  IF force_regenerate THEN
    start_date := current_date_val + 1; -- Empezamos desde mañana
    
    -- Borrar disponibilidad futura existente si se fuerza la regeneración
    -- OJO: Esto borraría excepciones manuales. El usuario debe ser advertido en el UI.
    DELETE FROM availability 
    WHERE gardener_id = target_gardener_id 
    AND date >= start_date;
    
  ELSE
    -- Modo mantenimiento: Solo añadir días que falten después del último generado
    IF setting.last_generated_date IS NULL THEN
        start_date := current_date_val + 1;
    ELSE
        start_date := GREATEST(current_date_val + 1, setting.last_generated_date + 1);
    END IF;
  END IF;

  -- Si start_date > end_date, no hay nada que hacer (ya está cubierto)
  IF start_date > end_date THEN
    RETURN;
  END IF;

  -- Iterar por los días
  iter_date := start_date;
  WHILE iter_date <= end_date LOOP
    day_idx := EXTRACT(DOW FROM iter_date);
    
    -- Buscar reglas para este día de la semana
    FOR rule IN SELECT * FROM recurring_schedules WHERE gardener_id = target_gardener_id AND day_of_week = day_idx LOOP
      
      -- Convertir horarios TIME a horas enteras (asumiendo bloques de hora completa como el sistema actual)
      start_h := EXTRACT(HOUR FROM rule.start_time);
      end_h := EXTRACT(HOUR FROM rule.end_time);
      
      -- Si el end_time tiene minutos > 0, asumimos que cubre hasta la siguiente hora? 
      -- Simplificación: usaremos horas enteras para coincidir con la lógica actual de availabilityService.
      
      FOR h IN start_h .. (end_h - 1) LOOP
        -- Insertar slot si no existe
        -- Usamos INSERT ON CONFLICT DO NOTHING implícito al comprobar existencia o simplemente INSERT
        -- La tabla availability no tiene restricción UNIQUE estricta en todas las versiones, pero availability_blocks sí.
        -- availabilityServiceCompat usa INSERT directo.
        -- Vamos a intentar insertar.
        
        BEGIN
          INSERT INTO availability (gardener_id, date, start_time, end_time, is_available)
          VALUES (
            target_gardener_id, 
            iter_date, 
            (h || ':00:00')::TIME, 
            ((h + 1) || ':00:00')::TIME, 
            true
          );
        EXCEPTION WHEN OTHERS THEN
          -- Ignorar duplicados si violan constraints
          NULL;
        END;
        
      END LOOP;
    END LOOP;

    iter_date := iter_date + 1;
  END LOOP;

  -- Actualizar la fecha de última generación
  UPDATE recurring_availability_settings 
  SET last_generated_date = end_date 
  WHERE gardener_id = target_gardener_id;

END;
$$ LANGUAGE plpgsql;
