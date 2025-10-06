import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Read environment variables from .env file
const envContent = fs.readFileSync('.env', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) {
    envVars[key.trim()] = value.trim().replace(/^["']|["']$/g, '');
  }
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseServiceKey = envVars.VITE_SUPABASE_SERVICE_ROLE_KEY || envVars.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

// Use service role key to bypass RLS
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkProfilesAdmin() {
  const userId = '499ee776-dd3e-4c76-943f-c66aa8c539c3';
  
  console.log('🔍 Checking profiles with admin access for user:', userId);
  console.log('='.repeat(60));
  
  try {
    // Check all tables that might contain profiles
    const tables = ['profiles', 'gardener_profiles'];
    
    for (const table of tables) {
      console.log(`\n📋 Checking ${table} table:`);
      
      try {
        const { data, error, count } = await supabase
          .from(table)
          .select('*', { count: 'exact' })
          .eq('user_id', userId)
          .order('created_at', { ascending: true });
        
        if (error) {
          console.error(`❌ Error fetching from ${table}:`, error);
        } else {
          console.log(`Found ${count || data.length} records in ${table}:`);
          data.forEach((record, index) => {
            console.log(`  ${index + 1}. ID: ${record.id}, Created: ${record.created_at}`);
            if (record.role) console.log(`      Role: ${record.role}`);
            if (record.full_name) console.log(`      Name: ${record.full_name}`);
          });
        }
      } catch (err) {
        console.error(`❌ Exception checking ${table}:`, err.message);
      }
    }
    
    // Also check if there are any profiles at all
    console.log('\n📊 Total profiles in database:');
    const { count: totalProfiles } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });
    console.log(`Total profiles: ${totalProfiles}`);
    
    const { count: totalGardeners } = await supabase
      .from('gardener_profiles')
      .select('*', { count: 'exact', head: true });
    console.log(`Total gardener profiles: ${totalGardeners}`);
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkProfilesAdmin();