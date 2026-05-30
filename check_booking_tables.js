import { createClient } from '@supabase/supabase-js';
import { requireSupabaseAdminEnv } from './loadSupabaseAdminEnv.js';

let supabaseUrl;
let supabaseServiceKey;

try {
  ({ supabaseUrl, supabaseServiceRoleKey: supabaseServiceKey } = requireSupabaseAdminEnv());
} catch (error) {
  console.error(`❌ ${error.message}`);
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
