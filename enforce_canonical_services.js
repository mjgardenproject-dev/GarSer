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
  console.error('ℹ️ Añade tu Service Role Key de Supabase en .env para poder modificar la tabla services.');
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
    name: 'Corte de arbustos pequeños o ramas finas a tijera',
    description: 'Corte a tijera de arbustos pequeños y ramas finas para un acabado detallado.',
    base_price: 35,
    price_per_hour: 27,
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
];

async function enforceCanonicalServices() {
  console.log('🔎 Leyendo servicios actuales...');
  const { data: existing, error: readError } = await supabase
    .from('services')
    .select('*');
  if (readError) {
    console.error('❌ Error leyendo tabla services:', readError);
    process.exit(1);
  }

  const allowedSet = new Set(canonical.map(c => normalize(c.name)));

  // Eliminar todos los servicios que no sean de la lista canónica (por nombre normalizado)
  const toDelete = (existing || []).filter(s => !allowedSet.has(normalize(s.name)));
  if (toDelete.length > 0) {
    console.log(`🗑️ Eliminando ${toDelete.length} servicio(s) no canónicos...`);
    const { error: delError } = await supabase
      .from('services')
      .delete()
      .in('id', toDelete.map(s => s.id));
    if (delError) {
      console.error('❌ Error eliminando servicios:', delError);
      process.exit(1);
    }
    console.log('✅ Servicios no canónicos eliminados.');
  } else {
    console.log('✅ No hay servicios extra; el catálogo ya es canónico.');
  }

  // Asegurar que los 6 canónicos existan; si falta alguno, insertarlo
  const existingMap = new Map((existing || []).map(s => [normalize(s.name), s]));
  const toInsert = canonical.filter(c => !existingMap.has(normalize(c.name)));
  if (toInsert.length > 0) {
    console.log(`➕ Insertando ${toInsert.length} servicio(s) canónicos faltantes...`);
    const { error: insertError } = await supabase
      .from('services')
      .insert(toInsert);
    if (insertError) {
      console.error('❌ Error insertando servicios canónicos:', insertError);
      process.exit(1);
    }
    console.log('✅ Servicios canónicos insertados.');
  }

  console.log('🏁 Catálogo de servicios ahora contiene únicamente los 6 servicios canónicos.');
}

enforceCanonicalServices().then(() => process.exit(0));