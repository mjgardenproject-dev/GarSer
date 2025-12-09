// Script para debuggear tu perfil actual
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

let supabaseUrl, supabaseKey;
try {
  const envContent = fs.readFileSync('.env', 'utf8');
  const envLines = envContent.split('\n');
  for (const line of envLines) {
    if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
    if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
  }
} catch (e) {
  console.error('Error leyendo .env:', e.message);
}
if (!supabaseUrl || !supabaseKey) { console.error('Faltan variables de Supabase'); process.exit(1); }
const supabase = createClient(supabaseUrl, supabaseKey);

async function debugProfile() {
  console.log('🔍 Listando últimas solicitudes enviadas...');
  const { data: lastApps } = await supabase
    .from('gardener_applications')
    .select('id,user_id,status,submitted_at')
    .order('submitted_at', { ascending: false })
    .limit(5);
  console.log('Últimas solicitudes:', lastApps);

  const userId = lastApps?.[0]?.user_id;
  if (!userId) { console.log('No hay solicitudes registradas'); return; }
  console.log('👤 Usuario más reciente:', userId);

  const { data: gardenerData, error: gardenerError } = await supabase
    .from('gardener_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  const { data: applicationData, error: applicationError } = await supabase
    .from('gardener_applications')
    .select('*')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .maybeSingle();

  console.log('\n📋 profiles:', prof);
  console.log('🌿 gardener_profiles:', gardenerData || '—', '| err:', gardenerError || '—');
  console.log('📄 gardener_applications:', applicationData || '—', '| err:', applicationError || '—');

  console.log('\n📊 RESUMEN:');
  console.log('- Tiene perfil:', !!prof);
  console.log('- Tiene perfil de jardinero:', !!gardenerData);
  console.log('- Tiene solicitud:', !!applicationData);
  console.log('- Estado de solicitud:', applicationData?.status || '—');
}

debugProfile();
