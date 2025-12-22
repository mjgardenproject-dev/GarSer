// Supabase Edge Function: IA de estimación y auto‑presupuesto
// Requiere configurar el secreto OPENAI_API_KEY
declare const Deno: any;
import * as cfg from './config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface Payload {
  description: string;
  service_ids?: string[];
  photo_urls?: string[];
  photo_count?: number;
  // Nuevo modo de auto‑presupuesto por servicio
  mode?: 'auto_quote';
  service?: string; // nombre exacto del servicio
  image_url?: string; // http(s) o dataURL
}

// Mapeo de System Prompts por servicio (estrictamente detallados)
const PROMPTS: Record<string, string> = {
  'Corte de césped': [
    "Eres una IA especializada en análisis de jardines llamada 'GrassScan'. Tu objetivo es analizar imágenes para presupuestar un servicio de corte de césped.",
    '',
    'INSTRUCCIONES DE ANÁLISIS:',
    '1. Detecta la superficie total de césped en m², ignorando tierra, grava, mobiliario u otras áreas que no sean césped.',
    '2. Evalúa la altura del césped mediante textura y color, densidad, irregularidades y obstáculos.',
    '3. Analiza sombra y orientación para corregir áreas parcialmente visibles.',
    '4. Evalúa la accesibilidad: bordes, objetos, pendientes y obstáculos.',
    'DETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):',
    '- Nivel 1: Césped <3 cm, terreno llano, sin obstáculos.',
    '- Nivel 2: Césped 3–10 cm, algunos obstáculos, terreno ligeramente irregular, densidad media.',
    '- Nivel 3: Césped >10 cm, muchos obstáculos, terreno irregular, césped tupido o con malas hierbas.',
    '',
    'FORMATO DE SALIDA (JSON ÚNICAMENTE):',
    '{',
    '  "servicio": "Corte de césped",',
    '  "cantidad": [número estimado de m2],',
    '  "unidad": "m2",',
    '  "dificultad": [1, 2 o 3]',
    '}',
  ].join('\n'),
  'Corte de setos': [
    "Eres una IA especializada en análisis de jardines llamada 'HedgeMap'. Tu objetivo es analizar imágenes para presupuestar recorte de setos.",
    '',
    'INSTRUCCIONES DE ANÁLISIS:',
    '1. Detecta la superficie total de setos (largo × altura) en m².',
    '2. Analiza densidad, grosor de ramas y uniformidad.',
    '3. Evalúa accesibilidad frontal y trasera, necesidad de escalera o pértiga.',
    '4. Detecta obstáculos cercanos (macetas, vallas) y terreno irregular.',
    '',
    'DETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):',
    '- Nivel 1: Altura ≤1,5 m, ramas finas, accesible desde el suelo.',
    '- Nivel 2: Altura 1,5–2,5 m, ramas medianas, obstáculos moderados.',
    '- Nivel 3: Altura >2,5 m, ramas gruesas o densas, acceso limitado, requiere poda fuerte.',
    '',
    'FORMATO DE SALIDA (JSON ÚNICAMENTE):',
    '{',
    '  "servicio": "Corte de setos",',
    '  "cantidad": [número estimado de m2],',
    '  "unidad": "m2",',
    '  "dificultad": [1, 2 o 3]',
    '}',
  ].join('\n'),
  'Fumigación': [
    "Eres una IA especializada en análisis de jardines llamada 'PestVision'. Tu objetivo es analizar imágenes para presupuestar fumigación.",
    '',
    'INSTRUCCIONES DE ANÁLISIS:',
    '1. Detecta plantas afectadas por plagas o áreas continuas.',
    '2. IMPORTANTE: Para calcular la cantidad, convierte las plantas reales a "plantas equivalentes" usando esta fórmula mental:',
    '   Plantas_equivalentes = (altura_real_cm / 40) × (diametro_real_cm / 35)',
    '3. Detecta densidad de plaga y gravedad de daños.',
    '',
    'DETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):',
    '- Nivel 1: Plaga leve, <20% afectación, plantas ≤2 equivalentes.',
    '- Nivel 2: Afectación 20–60%, plantas 2–5 equivalentes, acceso parcial.',
    '- Nivel 3: >60% afectación, plantas >5 equivalentes, acceso difícil, plaga severa.',
    '',
    'FORMATO DE SALIDA (JSON ÚNICAMENTE):',
    '{',
    '  "servicio": "Fumigación",',
    '  "cantidad": [número de plantas equivalentes],',
    '  "unidad": "plantas",',
    '  "dificultad": [1, 2 o 3]',
    '}',
  ].join('\n'),
  'Poda de plantas': [
    "Eres una IA especializada en análisis de jardines llamada 'PlantShapeAI'. Tu objetivo es analizar arbustos, rosales u ornamentales (excluye árboles grandes).",
    '',
    'INSTRUCCIONES DE ANÁLISIS:',
    '1. Detecta plantas que requieren poda.',
    '2. IMPORTANTE: Convierte cada planta a "plantas equivalentes" usando esta fórmula:',
    '   Plantas_equivalentes = (altura_real_cm / 40) × (diametro_real_cm / 35)',
    '3. Evalúa densidad de ramas y dureza aparente.',
    '',
    'DETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):',
    '- Nivel 1: Plantas ≤1 m (≤2,5 equivalentes), ramas finas, accesibles, poda ligera.',
    '- Nivel 2: Plantas 1–1,8 m (2,5–4,5 equivalentes), ramas medianas, acceso parcial.',
    '- Nivel 3: Plantas >1,8 m (>4,5 equivalentes), ramas gruesas, densas, espacios reducidos, poda fuerte.',
    '',
    'FORMATO DE SALIDA (JSON ÚNICAMENTE):',
    '{',
    '  "servicio": "Poda de plantas",',
    '  "cantidad": [número de plantas equivalentes],',
    '  "unidad": "plantas",',
    '  "dificultad": [1, 2 o 3]',
    '}',
  ].join('\n'),
  'Poda de árboles': [
    "Eres una IA especializada en análisis de jardines llamada 'TreeScale'. Tu objetivo es analizar árboles para poda.",
    '',
    'INSTRUCCIONES DE ANÁLISIS:',
    '1. Detecta árboles que requieren poda.',
    '2. IMPORTANTE: Convierte a "árboles equivalentes" usando esta fórmula:',
    '   Árbol_equivalente = (altura_real_m / 3) × (diametro_copa_real_m / 2)',
    '3. Determina si se necesita escalera, pértiga o trabajo en altura.',
    '',
    'DETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):',
    '- Nivel 1: Árboles <3 m (≤1 equivalente), ramas finas, acceso fácil.',
    '- Nivel 2: Árboles 3–5 m (1–3 equivalentes), escalera o pértiga, obstáculos moderados.',
    '- Nivel 3: Árboles >5 m (>3 equivalentes), ramas gruesas, acceso difícil, trabajo en altura.',
    '',
    'FORMATO DE SALIDA (JSON ÚNICAMENTE):',
    '{',
    '  "servicio": "Poda de árboles",',
    '  "cantidad": [número de árboles equivalentes],',
    '  "unidad": "árboles",',
    '  "dificultad": [1, 2 o 3]',
    '}',
  ].join('\n'),
  'Labrar y quitar malas hierbas': [
    "Eres una IA especializada en análisis de jardines llamada 'SoilSense'. Tu objetivo es analizar terreno para deshierbe manual y labrado.",
    '',
    'INSTRUCCIONES DE ANÁLISIS:',
    '1. Detecta zonas con malas hierbas y calcula superficie en m².',
    '2. Evalúa densidad, tamaño de hierbas, dureza del suelo y piedras/raíces.',
    '',
    'DETERMINACIÓN DE DIFICULTAD (Elige 1, 2 o 3):',
    '- Nivel 1: Hierbas pequeñas, poco densas, terreno suelto y llano.',
    '- Nivel 2: Hierbas medianas, densidad moderada, tierra parcialmente compacta.',
    '- Nivel 3: Hierbas grandes, densas, raíces profundas, terreno duro, acceso difícil.',
    '',
    'FORMATO DE SALIDA (JSON ÚNICAMENTE):',
    '{',
    '  "servicio": "Labrar y quitar malas hierbas",',
    '  "cantidad": [número estimado de m2],',
    '  "unidad": "m2",',
    '  "dificultad": [1, 2 o 3]',
    '}',
  ].join('\n'),
};

function buildMessages(payload: Payload) {
  const { description, service_ids = [], photo_urls = [] } = payload;
  const userContent: any[] = [
    { type: 'text', text: `Descripción del cliente: ${description || ''}` },
    { type: 'text', text: `Servicios seleccionados (informativo): ${service_ids.join(', ')}` },
  ];

  // Adjuntar hasta 4 imágenes para limitar coste/tiempo
  photo_urls.slice(0, 4).forEach((url) => {
    userContent.push({
      type: 'image_url',
      image_url: { url, detail: 'auto' },
    });
  });

  const systemPrompt = [
    'Actúa como un asistente especializado en jardinería. Tu tarea es analizar una imagen del jardín y la descripción escrita del cliente para generar una lista estructurada de tareas necesarias.',
    'Tu salida será un JSON válido y limpio, sin texto adicional, que contenga todos los tipos de trabajos detectados junto con las variables necesarias para que un sistema de presupuestos los procese automáticamente.',
    '',
    '1️⃣ SERVICIOS POSIBLES',
    'Solo puedes detectar los siguientes tipos de servicio:',
    'Corte de césped',
    'Poda de plantas',
    'Corte de setos a máquina',
    'Poda de árboles',
    'Labrar y quitar malas hierbas a mano',
    'Fumigación de plantas',
    '',
    '2️⃣ VARIABLES A DETECTAR',
    'Para cada servicio identificado, devuelve:',
    'tipo_servicio: uno de los listados arriba.',
    'estado_jardin: “normal”, “descuidado” o “muy descuidado”.',
    'superficie_m2: número estimado solo para:',
    ' - Corte de césped',
    ' - Corte de setos a máquina',
    ' - Labrar y quitar malas hierbas',
    'numero_plantas: número aproximado solo para:',
    ' - Fumigación',
    ' - Poda de plantas',
    ' - Poda de árboles',
    'tamaño_plantas: “pequeñas” (<0,5 m), “medianas” (0,5–1 m), “grandes” (1–1,5 m), “muy grandes” (1,5–2 m).',
    '',
    '3️⃣ CONTROL DE INCERTIDUMBRE',
    'Si no estás completamente seguro de alguno de los valores, no lo inventes. En esos casos, usa el valor null.',
    '',
    '4️⃣ SUPERFICIE VISIBLE',
    'Calcula únicamente la superficie visible en la imagen, sin estimar zonas que no se vean con claridad.',
    'Si solo se muestra una parte del jardín, estima el área de la parte visible y trabajable, no de toda la propiedad.',
    '',
    '5️⃣ NORMALIZACIÓN DE UNIDADES',
    'Devuelve siempre solo una unidad válida según el tipo de servicio:',
    'Césped, setos, labrado o malas hierbas → superficie_m2',
    'Poda o fumigación → numero_plantas + tamaño_plantas',
    'No mezcles unidades dentro de una misma tarea.',
    '',
    '6️⃣ ESTRUCTURA DE RESPUESTA',
    'Devuelve únicamente un JSON con esta estructura exacta:',
    '{',
    '  "tareas": [',
    '    {',
    '      "tipo_servicio": "",',
    '      "estado_jardin": "",',
    '      "superficie_m2": null,',
    '      "numero_plantas": null,',
    '      "tamaño_plantas": null',
    '    }',
    '  ]',
    '}',
    'Puedes incluir tantas tareas como sean necesarias dentro del array "tareas".',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

async function callOpenAI(messages: any[]) {
  const apiKey = Deno.env.get('OPENAI_API_KEY');
  if (!apiKey) {
    return { tareas: [], reasons: ['Falta OPENAI_API_KEY'] };
  }

  const body = {
    model: 'gpt-4o-mini',
    messages,
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    console.error('OpenAI error:', txt);
    return { tareas: [], reasons: ['Error llamando a OpenAI'] };
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch {
    return { tareas: [], reasons: ['Respuesta no parseable'] };
  }
}

function heuristicTasks(payload: Payload) {
  const text = (payload.description || '').toLowerCase();
  const tasks: any[] = [];
  const estado: 'normal' | 'descuidado' | 'muy descuidado' = text.includes('muy descuidado')
    ? 'muy descuidado'
    : text.includes('descuidado')
      ? 'descuidado'
      : 'normal';

  if (text.includes('césped') || text.includes('cesped') || text.includes('pasto')) {
    tasks.push({
      tipo_servicio: 'corte de césped',
      estado_jardin: estado,
      superficie_m2: null,
      numero_plantas: null,
      tamaño_plantas: null,
    });
  }
  if (text.includes('seto') || text.includes('setos')) {
    tasks.push({
      tipo_servicio: 'corte de setos a máquina',
      estado_jardin: estado,
      superficie_m2: null,
      numero_plantas: null,
      tamaño_plantas: null,
    });
  }
  if (text.includes('arbol') || text.includes('árbol')) {
    tasks.push({
      tipo_servicio: 'poda de árboles',
      estado_jardin: estado,
      superficie_m2: null,
      numero_plantas: null,
      tamaño_plantas: null,
    });
  } else if (text.includes('poda')) {
    tasks.push({
      tipo_servicio: 'poda de plantas',
      estado_jardin: estado,
      superficie_m2: null,
      numero_plantas: null,
      tamaño_plantas: null,
    });
  }
  if (text.includes('malas hierbas') || text.includes('hierbas') || text.includes('maleza') || text.includes('labrado')) {
    tasks.push({
      tipo_servicio: 'labrar y quitar malas hierbas a mano',
      estado_jardin: estado,
      superficie_m2: null,
      numero_plantas: null,
      tamaño_plantas: null,
    });
  }
  if (text.includes('fumig') || text.includes('plaga')) {
    tasks.push({
      tipo_servicio: 'fumigación de plantas',
      estado_jardin: estado,
      superficie_m2: null,
      numero_plantas: null,
      tamaño_plantas: null,
    });
  }

  return { tareas: tasks, reasons: ['Heurística local'] };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const payload = (await req.json()) as Payload;

    // Nuevo modo: auto‑presupuesto por servicio único
    if (payload.mode === 'auto_quote' && payload.service && payload.image_url) {
      const system = PROMPTS[payload.service];
      if (!system) {
        return new Response(JSON.stringify({ error: 'Servicio no soportado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const userContent: any[] = [
        { type: 'text', text: `Analiza la imagen y devuelve SOLO JSON. Servicio: ${payload.service}.` },
        { type: 'image_url', image_url: { url: payload.image_url, detail: 'auto' } },
      ];
      if (payload.description) userContent.unshift({ type: 'text', text: `Notas del cliente: ${payload.description}` });

      const messages = [
        { role: 'system', content: system },
        { role: 'user', content: userContent },
      ];
      const analysis = await callOpenAI(messages);
      const servicio = analysis?.servicio as string | undefined;
      const cantidad = Number(analysis?.cantidad ?? 0);
      const unidad = analysis?.unidad as string | undefined;
      const dificultad = Number(analysis?.dificultad ?? 1) as 1 | 2 | 3;

      const perf = cfg.PERFORMANCE_PRICING[payload.service];
      const mult = cfg.DIFFICULTY_MULTIPLIER[dificultad] ?? 1.0;
      if (!perf) {
        return new Response(JSON.stringify({ error: 'Config no disponible para el servicio' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      const tiempo_estimado_horas = (cantidad / perf.performance) * mult;
      const precio_estimado = (cantidad * perf.pricePerUnit) * mult;

      const out = {
        analysis: { servicio, cantidad, unidad, dificultad },
        result: {
          tiempo_estimado_horas: Math.round(tiempo_estimado_horas * 100) / 100,
          precio_estimado: Math.round(precio_estimado * 100) / 100,
        },
        version: 'v1',
      };
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Modo existente: estimación de tareas múltiples desde imágenes/texto
    const messages = buildMessages(payload);
    const ai = await callOpenAI(messages);
    const tareas = Array.isArray(ai?.tareas) ? ai.tareas : [];
    if (tareas.length > 0) {
      return new Response(JSON.stringify({ tareas }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const h = heuristicTasks(payload);
    return new Response(JSON.stringify(h), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    console.error('Estimator error:', err);
    const h = heuristicTasks({ description: '', photo_count: 0 });
    return new Response(
      JSON.stringify({ ...h, reasons: ['Error interno'] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
