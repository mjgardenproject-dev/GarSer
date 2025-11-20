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
          'Eres un asistente experto en jardinería. PRIORIDAD: analiza primero las IMÁGENES y usa el TEXTO solo para complementar o desambiguar.',
          'Devuelve SIEMPRE un JSON válido, sin texto extra, con las tareas detectadas y los campos necesarios para estimación automática.',
          '',
          'SERVICIOS PERMITIDOS (nombre EXACTO en español):',
          '- Corte de césped',
          '- Poda de plantas',
          '- Corte de setos a máquina',
          '- Corte de arbustos pequeños o ramas finas a tijera',
          '- Labrar y quitar malas hierbas a mano',
          '- Fumigación de plantas',
          '- Poda de palmeras',
          '',
          'CAMPOS OBLIGATORIOS POR TAREA:',
          '- tipo_servicio: uno de la lista anterior (nombre exacto, en español).',
          '- estado_jardin: "normal" | "descuidado" | "muy descuidado".',
          '- superficie_m2: número estimado SOLO para césped, setos a máquina, labrado/malas hierbas; en otros servicios usa null.',
          '- numero_plantas: número SOLO para fumigación y corte a tijera; en otros servicios usa null.',
          '- tamaño_plantas: "pequeñas" | "medianas" | "grandes" | "muy grandes" SOLO cuando aplica (fumigación/tijera); en otros servicios usa null.',
          '',
          'REGLAS DE INCERTIDUMBRE:',
          '- Si no estás seguro, NO inventes. Usa null.',
          '- Si el TEXTO pide un servicio que NO se ve en la IMAGEN, puedes incluirlo con métricas en null y explica en reasons que proviene del texto.',
          '',
          'UNIDADES (NO mezclar dentro de la misma tarea):',
          '- Césped, setos a máquina, labrado/malas hierbas → superficie_m2.',
          '- Tijera y fumigación → numero_plantas + tamaño_plantas.',
          '',
          'FORMA DE RESPUESTA: SOLO JSON con la siguiente estructura y una lista opcional "reasons" para explicar decisiones importantes:',
          '{"tareas":[{"tipo_servicio":"","estado_jardin":"","superficie_m2":null,"numero_plantas":null,"tamaño_plantas":null}],"reasons":["..."]}'
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analiza principalmente las imágenes adjuntas (1–4). Usa el texto solo como complemento.' },
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
