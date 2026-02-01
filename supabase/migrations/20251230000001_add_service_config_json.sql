-- Añadir columna JSONB para configuraciones avanzadas de precios
ALTER TABLE public.gardener_service_prices
ADD COLUMN IF NOT EXISTS additional_config JSONB DEFAULT '{}'::jsonb;

-- Comentario explicativo
COMMENT ON COLUMN public.gardener_service_prices.additional_config IS 'Configuración avanzada específica del servicio (ej. tablas de precios por especie/altura para palmeras)';
