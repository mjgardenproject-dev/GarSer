import fs from 'fs';
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

async function applyConstraintsMigration() {
  console.log('🔧 Applying constraints migration to prevent duplicate profiles...');
  console.log('='.repeat(60));
  
  try {
    // Read the migration file
    const migrationSQL = fs.readFileSync('./supabase/migrations/20250102000000_prevent_duplicate_profiles.sql', 'utf8');
    
    console.log('📄 Migration file loaded successfully');
    
    // Note: Since we can't execute raw SQL directly with the client library,
    // we'll provide instructions for manual execution
    console.log('\n⚠️  Manual Migration Required');
    console.log('Since we cannot execute raw SQL directly, please follow these steps:');
    console.log('\n1. Go to your Supabase dashboard');
    console.log('2. Navigate to the SQL Editor');
    console.log('3. Copy and paste the following SQL:');
    console.log('\n' + '='.repeat(60));
    console.log(migrationSQL);
    console.log('='.repeat(60));
    console.log('\n4. Execute the SQL in the Supabase dashboard');
    console.log('\nThis migration will:');
    console.log('✅ Clean up any existing duplicate profiles');
    console.log('✅ Add unique constraints to prevent future duplicates');
    console.log('✅ Create triggers to enforce the constraints');
    
    // Alternative: Try to check if constraints already exist
    console.log('\n🔍 Checking current database state...');
    
    // Check if we can query the database structure
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('user_id', { count: 'exact', head: true });
      
      if (!profilesError) {
        console.log(`📊 Current profiles count: ${profiles || 0}`);
      }
      
      const { data: gardenerProfiles, error: gardenerError } = await supabase
        .from('gardener_profiles')
        .select('user_id', { count: 'exact', head: true });
      
      if (!gardenerError) {
        console.log(`🌱 Current gardener profiles count: ${gardenerProfiles || 0}`);
      }
      
    } catch (error) {
      console.log('❌ Could not check database state:', error.message);
    }
    
  } catch (error) {
    console.error('❌ Error applying migration:', error);
  }
}

applyConstraintsMigration();
