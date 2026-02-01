import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Leer variables de entorno desde .env
const envPath = '.env';
if (!fs.existsSync(envPath)) {
  console.error('❌ No se encontró .env en el directorio del proyecto.');
  process.exit(1);
}
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (!key) return;
  const v = (value || '').trim().replace(/^"|"$/g, '');
  envVars[key.trim()] = v;
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseServiceKey = envVars.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ Falta VITE_SUPABASE_URL en .env');
  process.exit(1);
}
if (!supabaseServiceKey) {
  console.error('❌ Falta VITE_SUPABASE_SERVICE_ROLE_KEY en .env');
  console.error('ℹ️ Añade tu Service Role Key de Supabase en .env para poder insertar en la tabla services.');
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
    base_price: 30,
    price_per_hour: 25,
  },
  {
    name: 'Poda de plantas',
    description: 'Poda profesional de plantas para favorecer el crecimiento y mantener la estética del jardín.',
    base_price: 40,
    price_per_hour: 28,
  },
  {
    name: 'Corte de setos a máquina',
    description: 'Diseño y mantenimiento de setos con un acabado limpio y cuidado usando maquinaria adecuada.',
    base_price: 35,
    price_per_hour: 27,
  },
  {
    name: 'Poda de árboles',
    description: 'Poda profesional de árboles para favorecer el crecimiento y mantener la seguridad. Incluye retirada de ramas.',
    base_price: 55,
    price_per_hour: 35,
  },
  {
    name: 'Labrar y quitar malas hierbas a mano',
    description: 'Labrado y eliminación manual de malas hierbas para limpiar y preparar el terreno.',
    base_price: 30,
    price_per_hour: 25,
  },
  {
    name: 'Fumigación de plantas',
    description: 'Tratamientos específicos para proteger plantas y césped. El coste de los productos no está incluido.',
    base_price: 50,
    price_per_hour: 30,
  },
  {
    name: 'Poda de palmeras',
    description: 'Poda y limpieza de palmeras, retirada de hojas secas y frutos.',
    base_price: 60,
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
        base_price: 55,
        price_per_hour: 35,
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
