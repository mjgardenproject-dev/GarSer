import { createClient } from '@supabase/supabase-js';
import { requireSupabaseAdminEnv } from './loadSupabaseAdminEnv.js';

let supabaseUrl;
let supabaseServiceKey;

try {
  ({ supabaseUrl, supabaseServiceRoleKey: supabaseServiceKey } = requireSupabaseAdminEnv());
} catch (error) {
  console.error(`❌ ${error.message}`);
  console.error(
    'ℹ️ Añade `SUPABASE_SERVICE_ROLE_KEY` en `.env` para poder insertar en la tabla `services` sin exponer secretos al navegador.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const normalize = (s) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const canonical = [
  {
    name: 'Corte de césped',
    description: 'Mantenimiento regular para un césped sano y uniforme. Incluye corte, perfilado y limpieza.',
    pricing_method: 'per_quantity',
    hourly_rate: 25,
  },
  {
    name: 'Poda de plantas y arbustos',
    description: 'Poda profesional de plantas para favorecer el crecimiento y mantener la estética del jardín.',
    pricing_method: 'per_hour',
    hourly_rate: 28,
  },
  {
    name: 'Corte de setos a máquina',
    description: 'Diseño y mantenimiento de setos con un acabado limpio y cuidado usando maquinaria adecuada.',
    pricing_method: 'per_quantity',
    hourly_rate: 27,
  },
  {
    name: 'Poda de árboles',
    description: 'Poda profesional de árboles para favorecer el crecimiento y mantener la seguridad. Incluye retirada de ramas.',
    pricing_method: 'per_quantity',
    hourly_rate: 35,
  },
  {
    name: 'Servicios fitosanitarios',
    description: 'Tratamientos específicos para proteger plantas y césped. El coste de los productos no está incluido.',
    pricing_method: 'per_quantity',
    hourly_rate: 30,
  },
  {
    name: 'Poda de palmeras',
    description: 'Poda y limpieza de palmeras, retirada de hojas secas y frutos.',
    pricing_method: 'per_quantity',
  },
  {
    name: 'Desbroce de malas hierbas',
    description: 'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
    pricing_method: 'per_quantity',
    hourly_rate: 30,
  },
];

async function ensureServices() {
  console.log('🔎 Comprobando servicios existentes...');
  const { data: existing, error } = await supabase
    .from('services')
    .select('id,name');
  if (error) {
    console.error('❌ Error leyendo tabla services:', error);
    process.exit(1);
  }
  const namesNorm = new Map();
  (existing || []).forEach(s => namesNorm.set(normalize(s.name), s));

  const oldName = 'Corte de arbustos pequeños o ramas finas a tijera';
  const newName = 'Poda de árboles';
  const oldNorm = normalize(oldName);
  const newNorm = normalize(newName);
  const oldExisting = namesNorm.get(oldNorm);
  const newExisting = namesNorm.get(newNorm);

  if (oldExisting && !newExisting) {
    console.log(`✏️ Renombrando servicio "${oldName}" → "${newName}"...`);
    const { error: updError } = await supabase
      .from('services')
      .update({
        name: newName,
        description: 'Poda profesional de árboles para favorecer el crecimiento y mantener la seguridad. Incluye retirada de ramas.',
        pricing_method: 'per_quantity',
        hourly_rate: 35,
      })
      .eq('id', oldExisting.id);
    if (updError) {
      console.error('❌ Error renombrando servicio:', updError);
      process.exit(1);
    }
    namesNorm.delete(oldNorm);
    namesNorm.set(newNorm, { id: oldExisting.id, name: newName });
  }

  const toInsert = canonical.filter(c => {
    const n = normalize(c.name);
    if (namesNorm.has(n)) return false;
    // También evitar duplicados por sinónimos comunes
    const synonyms = [
      'poda de arboles y arbustos',
      'recorte de setos',
      'desbroce',
      'control de plagas',
      'fumigacion y control de plagas',
    ];
    const existsSynonym = Array.from(namesNorm.keys()).some(k => synonyms.some(syn => k.includes(normalize(syn))));
    return !existsSynonym;
  });

  if (toInsert.length === 0) {
    console.log('✅ No hay servicios nuevos que insertar. Catálogo ya cubre las categorías IA.');
    return;
  }

  console.log(`➕ Insertando ${toInsert.length} servicio(s) faltantes...`);
  const { error: insertError } = await supabase
    .from('services')
    .insert(toInsert);
  if (insertError) {
    console.error('❌ Error insertando servicios:', insertError);
    process.exit(1);
  }
  console.log('✅ Servicios insertados correctamente.');
}

ensureServices().then(() => process.exit(0));
