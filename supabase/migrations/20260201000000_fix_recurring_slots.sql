-- Fix generate_recurring_slots function to populate both availability tables
-- and handle current day update when forced.

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
  end_date := current_date_val + (setting.weeks_to_maintain * 7);
  
  IF force_regenerate THEN
    -- Si forzamos, empezamos desde HOY para aplicar cambios inmediatos
    start_date := current_date_val;
    
    -- Borrar disponibilidad futura existente en ambas tablas
    DELETE FROM availability 
    WHERE gardener_id = target_gardener_id 
    AND date >= start_date;

    DELETE FROM availability_blocks 
    WHERE gardener_id = target_gardener_id 
    AND date >= start_date;
    
  ELSE
    -- Modo mantenimiento: Solo añadir días que falten después del último generado
    IF setting.last_generated_date IS NULL THEN
        start_date := current_date_val;
    ELSE
        start_date := GREATEST(current_date_val, setting.last_generated_date + 1);
    END IF;
  END IF;

  -- Si start_date > end_date, no hay nada que hacer
  IF start_date > end_date THEN
    RETURN;
  END IF;

  -- Iterar por los días
  iter_date := start_date;
  WHILE iter_date <= end_date LOOP
    day_idx := EXTRACT(DOW FROM iter_date);
    
    -- Buscar reglas para este día de la semana
    FOR rule IN SELECT * FROM recurring_schedules WHERE gardener_id = target_gardener_id AND day_of_week = day_idx LOOP
      
      start_h := EXTRACT(HOUR FROM rule.start_time);
      end_h := EXTRACT(HOUR FROM rule.end_time);
      
      FOR h IN start_h .. (end_h - 1) LOOP
        -- 1. Insertar en availability (Legacy)
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
          NULL; -- Ignore duplicates
        END;

        -- 2. Insertar en availability_blocks (New)
        BEGIN
          INSERT INTO availability_blocks (gardener_id, date, hour_block, is_available)
          VALUES (
            target_gardener_id, 
            iter_date, 
            h, 
            true
          )
          ON CONFLICT (gardener_id, date, hour_block) DO UPDATE
          SET is_available = true;
        EXCEPTION WHEN OTHERS THEN
          NULL; -- Ignore unexpected errors
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
