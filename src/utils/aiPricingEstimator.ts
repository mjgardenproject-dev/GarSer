export interface AITask {
  tipo_servicio: string;
  estado_jardin: string; // "normal" | "descuidado" | "muy descuidado"
  superficie_m2: number | null;
  numero_plantas: number | null;
  tamaño_plantas: string | null; // "pequeñas" | "medianas" | "grandes" | "muy grandes"
}

interface EstimationInput {
  description: string;
  photoCount: number;
  selectedServiceIds: string[];
  photoUrls?: string[]; // URLs de las fotos para análisis IA
}

interface EstimationResult {
  tareas: AITask[];
  reasons?: string[];
}

// Eliminar fallback: solo OpenAI
import { supabase } from '../lib/supabase';

export async function estimateWorkWithAI(input: EstimationInput): Promise<EstimationResult> {
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
  const preferEdge = import.meta.env.PROD || !openaiKey;
  console.log('[AI] VITE_OPENAI_API_KEY presente:', !!openaiKey, 'preferEdge:', preferEdge);

  if (preferEdge) {
    try {
      const { data, error } = await supabase.functions.invoke('ai-pricing-estimator', {
        body: {
          description: input.description,
          service_ids: input.selectedServiceIds,
          photo_urls: input.photoUrls,
          photo_count: input.photoCount,
        },
      });
      if (error) {
        console.warn('[AI] Edge Function error:', error);
        return { tareas: [] };
      }
      const tareas = Array.isArray((data as any)?.tareas) ? (data as any).tareas : [];
      const reasons = Array.isArray((data as any)?.reasons) ? (data as any).reasons : undefined;
      return { tareas, reasons };
    } catch (e) {
      console.warn('[AI] Fallo invocando Edge Function:', e);
      return { tareas: [] };
    }
  }
  const model = (import.meta.env.VITE_OPENAI_MODEL as string | undefined) || 'gpt-4o-mini';
  try {
    const messages: any[] = [
      {
        role: 'system',
        content: [
          'Actúa como un asistente especializado en jardinería. Tu tarea es analizar una imagen del jardín y la descripción escrita del cliente para generar una lista estructurada de tareas necesarias.',
          'Tu salida será un JSON válido y limpio, sin texto adicional, que contenga todos los tipos de trabajos detectados junto con las variables necesarias para que un sistema de presupuestos los procese automáticamente.',
          '',
          '1️⃣ SERVICIOS POSIBLES',
          'Solo puedes detectar los siguientes tipos de servicio:',
          'Corte de césped',
          'Poda de plantas',
          'Corte de setos a máquina',
          'Corte de arbustos pequeños o ramas finas a tijera',
          'Labrar y quitar malas hierbas a mano',
          'Fumigación de plantas',
          '',
          '2️⃣ VARIABLES A DETECTAR',
          'Para cada servicio identificado, devuelve:',
          'tipo_servicio: uno de los listados arriba.',
          'estado_jardin: “normal”, “descuidado” o “muy descuidado”.',
          'superficie_m2: número estimado solo para: Corte de césped, Corte de setos a máquina, Labrar y quitar malas hierbas',
          'numero_plantas: número aproximado solo para: Fumigación, Corte a tijera',
          'tamaño_plantas: “pequeñas” (<0,5 m), “medianas” (0,5–1 m), “grandes” (1–1,5 m), “muy grandes” (1,5–2 m).',
          '',
          '3️⃣ CONTROL DE INCERTIDUMBRE',
          'Si no estás completamente seguro de alguno de los valores, no lo inventes. En esos casos, usa el valor null.',
          '',
          '5️⃣ NORMALIZACIÓN DE UNIDADES',
          'Devuelve siempre solo una unidad válida según el tipo de servicio: Césped, setos, labrado o malas hierbas → superficie_m2; Arbustos o fumigación → numero_plantas + tamaño_plantas. No mezcles unidades dentro de una misma tarea.',
          '',
          '6️⃣ ESTRUCTURA DE RESPUESTA',
          'Devuelve únicamente un JSON con esta estructura exacta:',
          '{"tareas":[{"tipo_servicio":"","estado_jardin":"","superficie_m2":null,"numero_plantas":null,"tamaño_plantas":null}]}'
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analiza primero las imágenes adjuntas y describe el estado y trabajos necesarios; luego usa mi descripción como complemento.' },
          { type: 'text', text: `Descripción del cliente: ${input.description || ''}` },
          { type: 'text', text: `Servicios seleccionados: ${input.selectedServiceIds.join(', ')}` },
          ...((input.photoUrls || []).slice(0, 4).map((url) => ({
            type: 'image_url',
            image_url: { url },
          })))
        ],
      }
    ];

    console.log('[AI] Preparando llamada a OpenAI', {
      model,
      messagesCount: messages.length,
      hasPhotos: (input.photoUrls || []).length > 0,
      selectedServiceIds: input.selectedServiceIds,
    });
    if ((input.photoUrls || []).length > 0) {
      const first = (input.photoUrls || [])[0];
      console.log('[AI] Primer photoUrl tipo', { isDataUrl: first.startsWith('data:'), prefix: first.slice(0, 30) });
    }
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.2,
        response_format: { type: 'json_object' },
      }),
    });
    if (resp.ok) {
      const json = await resp.json();
      const content = json?.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      const tareas = parsed?.tareas as AITask[] | undefined;
      const reasons = parsed?.reasons as string[] | undefined;
      if (Array.isArray(tareas)) {
        return { tareas, reasons };
      }
    } else {
      const errorText = await resp.text();
      console.warn('[AI] OpenAI respuesta no OK:', errorText);
      
      // Si es rate limit, mostrar mensaje más claro
      if (resp.status === 429) {
        try {
          const errorData = JSON.parse(errorText);
          const message = errorData?.error?.message || 'Rate limit exceeded';
          console.error('[AI] Rate limit alcanzado:', message);
          throw new Error(`Rate limit de OpenAI alcanzado. ${message.includes('Please try again in') ? message.split('Please try again in')[1].split('.')[0] : 'Intenta de nuevo más tarde.'}`);
        } catch (parseError) {
          throw new Error('Rate limit de OpenAI alcanzado. Intenta de nuevo en unos minutos.');
        }
      }
    }
  } catch (e) {
    console.warn('[AI] Error en OpenAI:', e);
  }
  // Sin fallback: devolver vacío para que el UI informe y se reintente
  return { tareas: [] };
}

/* Merged into primary estimateWorkWithAI; duplicate removed to avoid conflicts */
