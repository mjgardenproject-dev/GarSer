// Supabase Edge Function: IA de estimación de horas para servicios de jardinería
// Requiere configurar el secreto OPENAI_API_KEY

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
}

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
      image_url: { url },
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
    'Corte de arbustos pequeños o ramas finas a tijera',
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
    ' - Corte a tijera',
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
    'Arbustos o fumigación → numero_plantas + tamaño_plantas',
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
  if (text.includes('poda') || text.includes('arbusto') || text.includes('ramas')) {
    tasks.push({
      tipo_servicio: 'corte de arbustos pequeños o ramas finas a tijera',
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
    // Intentar IA para obtener tareas; si falla, heurística simple
    const messages = buildMessages(payload);
    const ai = await callOpenAI(messages);
    const tareas = Array.isArray(ai?.tareas) ? ai.tareas : [];
    if (tareas.length > 0) {
      return new Response(
        JSON.stringify({ tareas }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const h = heuristicTasks(payload);
    return new Response(
      JSON.stringify(h),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Estimator error:', err);
    const h = heuristicTasks({ description: '', photo_count: 0 });
    return new Response(
      JSON.stringify({ ...h, reasons: ['Error interno'] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});