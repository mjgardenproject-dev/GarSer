import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://hleqspdnjfswrmozjkai.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZXFzcGRuamZzd3Jtb3pqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1OTI1MjQsImV4cCI6MjA3MzE2ODUyNH0.WFVv7I5xFdIGsj40ln3Wt4qltMO9fFcmSdKLkoRlvEE';
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkMissingTables() {
  console.log('Checking for missing tables...\n');
  
  const tables = ['booking_requests', 'booking_responses', 'booking_blocks', 'availability_blocks'];
  
  for (const table of tables) {
    try {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .limit(1);
      
      if (error) {
        console.log(`❌ Table '${table}' does not exist: ${error.message}`);
      } else {
        console.log(`✅ Table '${table}' exists`);
      }
    } catch (error) {
      console.log(`❌ Error checking table '${table}': ${error.message}`);
    }
  }
}

checkMissingTables();