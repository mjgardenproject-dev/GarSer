-- Tabla para los horarios fijos (plantillas)
CREATE TABLE IF NOT EXISTS public.recurring_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  gardener_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Domingo, 1=Lunes...
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Tabla para configuración de disponibilidad recurrente
CREATE TABLE IF NOT EXISTS public.recurring_availability_settings (
  gardener_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  weeks_to_maintain INT DEFAULT 2 CHECK (weeks_to_maintain BETWEEN 1 AND 12),
  min_notice_hours INT DEFAULT 24,
  last_generated_date DATE,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Políticas de seguridad (RLS)
ALTER TABLE public.recurring_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_availability_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own recurring schedules" ON public.recurring_schedules;
CREATE POLICY "Users can manage own recurring schedules" ON public.recurring_schedules
  USING (auth.uid() = gardener_id) WITH CHECK (auth.uid() = gardener_id);

DROP POLICY IF EXISTS "Users can manage own recurring settings" ON public.recurring_availability_settings;
CREATE POLICY "Users can manage own recurring settings" ON public.recurring_availability_settings
  USING (auth.uid() = gardener_id) WITH CHECK (auth.uid() = gardener_id);
