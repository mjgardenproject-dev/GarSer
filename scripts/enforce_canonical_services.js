import { createClient } from '@supabase/supabase-js';
import { requireSupabaseAdminEnv } from './loadSupabaseAdminEnv.js';

let supabaseUrl;
let supabaseServiceKey;

try {
  ({ supabaseUrl, supabaseServiceRoleKey: supabaseServiceKey } = requireSupabaseAdminEnv());
} catch (error) {
  console.error(`❌ ${error.message}`);
  console.error(
    'ℹ️ Añade `SUPABASE_SERVICE_ROLE_KEY` en `.env` para poder modificar la tabla `services` sin exponer secretos al navegador.'
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
  },
  {
    name: 'Poda de plantas y arbustos',
    description: 'Poda profesional de plantas para favorecer el crecimiento y mantener la estética del jardín.',
  },
  {
    name: 'Poda de setos',
    description: 'Diseño y mantenimiento de setos con un acabado limpio y cuidado usando maquinaria adecuada.',
  },
  {
    name: 'Poda de árboles',
    description: 'Poda profesional de árboles para favorecer el crecimiento y mantener la seguridad. Incluye retirada de ramas.',
  },
  {
    name: 'Servicios fitosanitarios',
    description: 'Tratamientos específicos para proteger plantas y césped. El coste de los productos no está incluido.',
  },
  {
    name: 'Poda de palmeras',
    description: 'Poda y limpieza de palmeras, retirada de hojas secas y frutos.',
  },
  {
    name: 'Desbroce de malas hierbas',
    description: 'Limpieza y desbroce de terrenos con maleza, matorrales y malas hierbas.',
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

  const existingByNorm = new Map((existing || []).map(s => [normalize(s.name), s]));
  
  // Renombre 1: Poda de árboles
  const oldName1 = 'Corte de arbustos pequeños o ramas finas a tijera';
  const newName1 = 'Poda de árboles';
  const oldNorm1 = normalize(oldName1);
  const newNorm1 = normalize(newName1);
  const oldExisting1 = existingByNorm.get(oldNorm1);
  const newExisting1 = existingByNorm.get(newNorm1);
  if (oldExisting1 && !newExisting1) {
    console.log(`✏️ Renombrando servicio "${oldName1}" → "${newName1}"...`);
    const { error: updError } = await supabase
      .from('services')
      .update({
        name: newName1,
        description: 'Poda profesional de árboles para favorecer el crecimiento y mantener la seguridad. Incluye retirada de ramas.',
      })
      .eq('id', oldExisting1.id);
    if (updError) {
      console.error('❌ Error renombrando servicio:', updError);
      process.exit(1);
    }
    existingByNorm.delete(oldNorm1);
    existingByNorm.set(newNorm1, { ...oldExisting1, name: newName1 });
  }

  // Renombre 2: Poda de setos
  const oldName2 = 'Poda de setos a máquina';
  const newName2 = 'Poda de setos';
  const oldNorm2 = normalize(oldName2);
  const newNorm2 = normalize(newName2);
  const oldExisting2 = existingByNorm.get(oldNorm2);
  const newExisting2 = existingByNorm.get(newNorm2);
  if (oldExisting2 && !newExisting2) {
    console.log(`✏️ Renombrando servicio "${oldName2}" → "${newName2}"...`);
    const { error: updError } = await supabase
      .from('services')
      .update({
        name: newName2,
        description: 'Diseño y mantenimiento de setos con un acabado limpio y cuidado usando maquinaria adecuada.',
      })
      .eq('id', oldExisting2.id);
    if (updError) {
      console.error('❌ Error renombrando servicio:', updError);
      process.exit(1);
    }
    existingByNorm.delete(oldNorm2);
    existingByNorm.set(newNorm2, { ...oldExisting2, name: newName2 });
  }

  // Asegurar que los 7 canónicos existan; si falta alguno, insertarlo
  const toInsert = canonical.filter(c => !existingByNorm.has(normalize(c.name)));
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

  console.log('🏁 Servicios actualizados.');
}

enforceCanonicalServices().then(() => process.exit(0));
