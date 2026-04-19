-- Habilitar extensión pg_cron (Si está disponible en el proyecto Supabase)
-- NOTA: Requiere permisos de superusuario, ejecutar en el panel SQL de Supabase.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Crear tabla de auditoría para IA
CREATE TABLE IF NOT EXISTS public.ai_analysis_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    request_id text,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    service_name text NOT NULL,
    prompt_version text NOT NULL,
    latency_ms integer NOT NULL,
    raw_response jsonb NOT NULL,
    created_at timestamptz DEFAULT now() NOT NULL
);

-- Índices para búsquedas rápidas
CREATE INDEX IF NOT EXISTS idx_ai_logs_created_at ON public.ai_analysis_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_logs_service_name ON public.ai_analysis_logs(service_name);
CREATE INDEX IF NOT EXISTS idx_ai_logs_user_id ON public.ai_analysis_logs(user_id);

-- RLS (Row Level Security)
ALTER TABLE public.ai_analysis_logs ENABLE ROW LEVEL SECURITY;

-- Solo Service Role puede insertar/leer (la Edge Function)
CREATE POLICY "Service Role can full access ai_analysis_logs" 
ON public.ai_analysis_logs 
TO service_role 
USING (true) 
WITH CHECK (true);

-- Configurar pg_cron para limpiar logs antiguos (> 30 días)
-- Esto se ejecuta a las 02:00 AM todos los días.
SELECT cron.schedule(
    'purge-old-ai-logs',
    '0 2 * * *',
    $$ DELETE FROM public.ai_analysis_logs WHERE created_at < now() - interval '30 days'; $$
);
