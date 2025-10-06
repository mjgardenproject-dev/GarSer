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
const supabaseKey = envVars.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function investigateDuplicates() {
  const userId = '499ee776-dd3e-4c76-943f-c66aa8c539c3';
  
  console.log('🔍 Investigating duplicate profiles for user:', userId);
  console.log('='.repeat(60));
  
  try {
    // Check profiles table
    console.log('\n📋 Checking profiles table:');
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (profilesError) {
      console.error('❌ Error fetching profiles:', profilesError);
    } else {
      console.log(`Found ${profiles.length} profiles:`);
      profiles.forEach((profile, index) => {
        console.log(`  ${index + 1}. ID: ${profile.id}, Role: ${profile.role}, Created: ${profile.created_at}`);
      });
    }
    
    // Check gardener_profiles table
    console.log('\n🌱 Checking gardener_profiles table:');
    const { data: gardenerProfiles, error: gardenerError } = await supabase
      .from('gardener_profiles')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (gardenerError) {
      console.error('❌ Error fetching gardener profiles:', gardenerError);
    } else {
      console.log(`Found ${gardenerProfiles.length} gardener profiles:`);
      gardenerProfiles.forEach((profile, index) => {
        console.log(`  ${index + 1}. ID: ${profile.id}, Created: ${profile.created_at}`);
      });
    }
    
    // Check customer_profiles table
    console.log('\n👤 Checking customer_profiles table:');
    const { data: customerProfiles, error: customerError } = await supabase
      .from('customer_profiles')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    
    if (customerError) {
      console.error('❌ Error fetching customer profiles:', customerError);
    } else {
      console.log(`Found ${customerProfiles.length} customer profiles:`);
      customerProfiles.forEach((profile, index) => {
        console.log(`  ${index + 1}. ID: ${profile.id}, Created: ${profile.created_at}`);
      });
    }
    
  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

investigateDuplicates();