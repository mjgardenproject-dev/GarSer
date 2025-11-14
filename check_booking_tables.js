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

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkBookingTables() {
  console.log('🔍 Checking booking-related tables in database...\n');

  const tablesToCheck = [
    'bookings',
    'booking_requests', 
    'booking_responses',
    'services',
    'profiles',
    'gardener_profiles'
  ];

  for (const tableName of tablesToCheck) {
    try {
      console.log(`${tableName.padEnd(20)} - Checking...`);
      
      const { data, error } = await supabase
        .from(tableName)
        .select('*')
        .limit(1);

      if (error) {
        console.log(`❌ ${tableName.padEnd(20)} - ${error.message}`);
      } else {
        console.log(`✅ ${tableName.padEnd(20)} - EXISTS (${data.length} sample records)`);
      }
    } catch (err) {
      console.log(`❌ ${tableName.padEnd(20)} - Error: ${err.message}`);
    }
  }

  // Check what tables actually exist by trying to get table info
  console.log('\n📋 Attempting to list all tables...');
  try {
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        ORDER BY table_name;
      `
    });
    
    if (error) {
      console.log('❌ Could not list tables:', error.message);
    } else {
      console.log('✅ Available tables:');
      data.forEach(row => console.log(`   - ${row.table_name}`));
    }
  } catch (err) {
    console.log('❌ Error listing tables:', err.message);
  }
}

checkBookingTables().catch(console.error);