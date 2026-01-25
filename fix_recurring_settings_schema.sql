-- Script para corregir el esquema de recurring_availability_settings
-- Añade la columna faltante min_notice_hours

ALTER TABLE recurring_availability_settings 
ADD COLUMN IF NOT EXISTS min_notice_hours INT DEFAULT 24;

-- Comentario para la columna
COMMENT ON COLUMN recurring_availability_settings.min_notice_hours IS 'Antelación mínima en horas para recibir reservas';

-- Notificar a PostgREST para recargar el esquema (necesario para que la API reconozca la nueva columna inmediatamente)
NOTIFY pgrst, 'reload config';
