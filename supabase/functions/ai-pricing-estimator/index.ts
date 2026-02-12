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
  service_name?: string; // Nombre del servicio (opcional, para lógica específica)
  // Nuevo modo de auto‑presupuesto por servicio
  mode?: 'auto_quote';
  service?: string; // nombre exacto del servicio
  image_url?: string; // http(s) o dataURL
  model?: 'gpt-4o-mini' | 'gemini-2.0-flash';
}

// Mapeo de System Prompts por servicio (estrictamente detallados)
const PROMPTS: Record<string, string> = {
  'Poda de palmeras': [
    "You are an image analysis AI used in a gardening services marketplace.",
    "",
    "Your role is to analyze one or more images provided by a client and extract objective, visible data required to generate an automatic service estimate.",
    "",
    "You DO NOT calculate prices.",
    "You DO NOT explain your reasoning.",
    "You DO NOT include text outside the required JSON.",
    "",
    "Your task is limited strictly to image analysis.",
    "",
    "SERVICE:",
    "Poda de palmeras",
    "",
    "ANALYSIS OBJECTIVE:",
    "Analyze each provided image to identify the palm species, its approximate height range, and its maintenance state. Map each analysis to the corresponding image index.",
    "",
    "VARIABLES TO EXTRACT:",
    "For each image, extract:",
    "1. \"indice_imagen\": Integer representing the 0-based index of the analyzed image in the input list.",
    "2. \"especie\": The biological species of the palm.",
    "3. \"altura\": The height range of the palm trunk/overall structure.",
    "4. \"estado\": The maintenance condition of the palm.",
    "",
    "CLASSIFICATION RULES:",
    "",
    "SPECIES (Must be exactly one of):",
    "- \"Phoenix (datilera o canaria)\"",
    "- \"Washingtonia\"",
    "- \"Roystonea regia (cubana)\"",
    "- \"Syagrus romanzoffiana (cocotera)\"",
    "- \"Trachycarpus fortunei\"",
    "- \"Livistona\"",
    "- \"Kentia (palmito)\"",
    "- \"Phoenix roebelenii(pigmea)\"",
    "- \"cycas revoluta (falsa palmera)\"",
    "",
    "HEIGHT RANGES (Dependent on Species):",
    "- For \"Phoenix (datilera o canaria)\", \"Washingtonia\", \"Roystonea regia (cubana)\", \"Syagrus romanzoffiana (cocotera)\", \"Trachycarpus fortunei\":",
    "  - \"0-5\": Less than 5 meters.",
    "  - \"5-12\": Between 5 and 12 meters.",
    "  - \"12-20\": Between 12 and 20 meters.",
    "  - \"20+\": More than 20 meters.",
    "- For \"Livistona\", \"Kentia (palmito)\", \"Phoenix roebelenii(pigmea)\", \"cycas revoluta (falsa palmera)\":",
    "  - \"0-2\": Less than 2 meters.",
    "  - \"2+\": More than 2 meters.",
    "",
    "STATE (Maintenance Condition):",
    "- \"normal\": Standard condition. Few or no dry fronds. Evidence of regular maintenance. Clean appearance.",
    "- \"descuidado\": Some accumulation of dry/brown fronds (partial beard). Presence of some fruit clusters. Slightly overgrown.",
    "- \"muy descuidado\": Heavy accumulation of dry fronds (full/long beard). Abundant fruit clusters. Wild, unkempt appearance. Neglected for a long time.",
    "",
    "OUTPUT RULES (MANDATORY):",
    "- Return ONLY valid JSON",
    "- No explanations",
    "- No comments",
    "- No additional fields",
    "- No markdown",
    "- No text outside the JSON",
    "",
    "ESTIMATION RULES:",
    "- If a value cannot be determined with absolute certainty, provide the most reasonable estimate based on visible information.",
    "- Never return null or empty values unless explicitly allowed.",
    "- If multiple palms appear in one image, analyze the most prominent/central one.",
    "",
    "RESPONSE FORMAT (STRICT):",
    "{",
    "  \"palmas\": [",
    "    {",
    "      \"indice_imagen\": 0,",
    "      \"especie\": \"string\",",
    "      \"altura\": \"string\",",
    "      \"estado\": \"string\"",
    "    }",
    "  ]",
    "}"
  ].join('\n'),
  'Corte de césped': [
    `---
You are an expert image analysis AI for a gardening marketplace. Your task is to objectively analyze lawn areas visible in images to extract structured data.

CORE RULES:
1. OUTPUT MUST BE VALID JSON ONLY. No markdown (json), no conversational text.
2. DO NOT infer hidden areas. Analyze ONLY what is strictly visible.
3. DO NOT calculate prices.
4. Accuracy is priority over completeness. If unsure, declare lower reliability.

SERVICE CONTEXT:
Service Type: "Corte de césped"

---------------------------------------------------------------------
ANALYSIS LOGIC & RELIABILITY LEVELS (nivel_analisis):

Determine the level based on visibility, lighting, and scale references.

LEVEL 1 (High Confidence):
- Criteria: Entire lawn visible, perfect lighting, clear scale references (doors, people, standard paving).
- Output: All fields populated. observaciones = null.

LEVEL 2 (Moderate Limitations):
- Criteria: Partial visibility, shadows, awkward angles, or lack of scale references.
- Output: All fields populated (best estimate). observaciones = ARRAY with specific allowed notes.

LEVEL 3 (Failed/Unusable):
- Criteria: Lawn not detectable, extreme blur, pitch black, or not a garden.
- Output: superficie_m2 = 0, especie_cesped = null, estado_jardin = null. observaciones = ARRAY with failure notes.

---------------------------------------------------------------------
DATA EXTRACTION RULES:

A) SURFACE AREA (superficie_m2):
- Estimate ONLY visible natural grass.
- USE REFERENCES: Look for standard objects (doors ~0.9m wide, cars ~4.5m long, standard tiles) to calibrate scale.
- If scale is impossible to determine (no references), set nivel_analisis = 2 and add "pocas referencias de escala".

B) SPECIES (especie_cesped):
- "Dichondra (oreja de ratón o similares)" -> Round leaves.
- "Gramón (Kikuyu, San Agustín o similares)" -> Very wide blades, creeping runners.
- "Bermuda (fina o gramilla)" -> Very fine, dense needle-like blades.
- "Césped Mixto (Festuca/Raygrass)" -> DEFAULT. Use this if distance prevents blade analysis.

C) CONDITION (estado_jardin):
- "normal" -> Even surface, defined edges.
- "descuidado" -> Uneven height, invading edges.
- "muy descuidado" -> High weeds, undefined edges, wild appearance.

D) OBSERVACIONES (Allowed values ONLY):
- Level 2: "mala luz", "zonas no visibles", "foto de baja calidad", "pocas referencias de escala", "ángulo limitado", "parte del jardín fuera de encuadre", "posible solapamiento entre imágenes".
- Level 3: "muy mala luz", "foto extremadamente borrosa", "césped no detectable", "imagen no corresponde a un jardín", "superficie completamente fuera de encuadre", "imagen obstruida".

---------------------------------------------------------------------
RESPONSE FORMAT (JSON Schema):

{
  "tareas": [
    {
      "tipo_servicio": "Corte de césped",
      "especie_cesped": "string OR null",
      "estado_jardin": "string OR null",
      "superficie_m2": number,
      "numero_plantas": null,
      "tamaño_plantas": null,
      "nivel_analisis": integer (1, 2, or 3),
      "observaciones": ["string"] OR null
    }
  ]
}`
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
  const { description, service_ids = [], photo_urls = [], service_name } = payload;

  // Lógica específica para Poda de Palmeras
  if (service_name === 'Poda de palmeras') {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las siguientes imágenes e identifica las palmeras según el índice.` }
    ];

    photo_urls.slice(0, 5).forEach((url, idx) => {
      userContent.push({
        type: 'text',
        text: `Imagen Índice ${idx}:`
      });
      userContent.push({
        type: 'image_url',
        image_url: { url, detail: 'auto' },
      });
    });

    return [
      { role: 'system', content: PROMPTS['Poda de palmeras'] },
      { role: 'user', content: userContent },
    ];
  }

  // Lógica específica para Corte de césped (Nuevo)
  if (service_name === 'Corte de césped' || (service_name && service_name.toLowerCase().includes('césped'))) {
    const userContent: any[] = [
      { type: 'text', text: `Descripción del cliente: ${description || ''}` },
      { type: 'text', text: `Analiza las imágenes para el servicio de corte de césped.` }
    ];

    photo_urls.slice(0, 5).forEach((url, idx) => {
        userContent.push({
            type: 'image_url',
            image_url: { url, detail: 'auto' },
        });
    });

    return [
        { role: 'system', content: PROMPTS['Corte de césped'] },
        { role: 'user', content: userContent },
    ];
  }

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

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const buf = await blob.arrayBuffer();
    // Use standard Buffer approach or chunked processing for large files to avoid stack overflow
    // In Deno/Edge, btoa on very large strings can cause stack overflow if spread operator is used on massive arrays
    // Better approach:
    const bytes = new Uint8Array(buf);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return base64;
  } catch (e) {
    console.warn('Error fetching image for Gemini:', e);
    return null;
  }
}

async function callGemini(messages: any[]) {
  const apiKey = Deno.env.get('GOOGLE_API_KEY');
  if (!apiKey) {
    return { tareas: [], reasons: ['Falta GOOGLE_API_KEY'] };
  }

  // Extract system prompt
  const systemMsg = messages.find(m => m.role === 'system');
  const systemPrompt = systemMsg ? systemMsg.content : '';

  // Build contents
  const contents: any[] = [];
  
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    
    if (msg.role === 'user') {
       const parts: any[] = [];
       if (Array.isArray(msg.content)) {
         for (const part of msg.content) {
           if (part.type === 'text') {
             parts.push({ text: part.text });
           } else if (part.type === 'image_url') {
             const url = part.image_url?.url;
             if (url) {
               const base64 = await fetchImageAsBase64(url);
               if (base64) {
                 parts.push({
                   inline_data: {
                     mime_type: 'image/jpeg',
                     data: base64
                   }
                 });
               }
             }
           }
         }
       } else {
         parts.push({ text: msg.content });
       }
       if (parts.length > 0) {
         contents.push({ role: 'user', parts });
       }
    }
  }

  const body = {
    contents,
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      response_mime_type: "application/json"
    }
  };

  // Implement simple retry logic for 429
  let attempts = 0;
  const maxAttempts = 3;
  
  while (attempts < maxAttempts) {
    attempts++;
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (resp.ok) {
        const data = await resp.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        try {
            return JSON.parse(text);
        } catch {
            return { tareas: [], reasons: ['Respuesta Gemini no parseable'] };
        }
    }

    if (resp.status === 429) {
        const txt = await resp.text();
        console.warn(`Gemini 429 Rate Limit (Attempt ${attempts}/${maxAttempts}):`, txt);
        if (attempts < maxAttempts) {
            // Wait 2s, 4s, etc.
            const delay = 2000 * attempts;
            await new Promise(r => setTimeout(r, delay));
            continue;
        }
        return { tareas: [], reasons: ['Gemini Rate Limit Exceeded'] };
    }

    const txt = await resp.text();
    console.error('Gemini error:', txt);
    return { tareas: [], reasons: ['Error llamando a Gemini'] };
  }
  return { tareas: [], reasons: ['Gemini Failed'] };
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
      
      let analysis;
      if (payload.model === 'gemini-2.0-flash') {
        analysis = await callGemini(messages);
        // Fallback to OpenAI if Gemini fails (Rate Limit or other error)
        if (!analysis || !analysis.servicio || (analysis.reasons && analysis.reasons.length > 0)) {
           console.warn('Gemini failed, falling back to OpenAI...');
           analysis = await callOpenAI(messages);
        }
      } else {
        analysis = await callOpenAI(messages);
      }

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
    
    let ai;
    if (payload.model === 'gemini-2.0-flash') {
      ai = await callGemini(messages);
      // Fallback to OpenAI if Gemini fails
      if (!ai || (!ai.tareas && !ai.palmas) || (ai.reasons && ai.reasons.length > 0)) {
           console.warn('Gemini failed, falling back to OpenAI...');
           ai = await callOpenAI(messages);
      }
    } else {
      ai = await callOpenAI(messages);
    }

    // Check if both AIs failed (OpenAI also returned error reasons or insufficient quota)
    if (!ai || (!ai.tareas && !ai.palmas)) {
        console.warn('Both AI models failed. Falling back to heuristic/manual mode.');
        const h = heuristicTasks(payload);
        return new Response(JSON.stringify({ ...h, reasons: ['AI Quota Exceeded - Manual Mode'] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Support for Palm Analysis Response
    if (ai?.palmas && Array.isArray(ai.palmas)) {
      return new Response(JSON.stringify({ palmas: ai.palmas }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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
