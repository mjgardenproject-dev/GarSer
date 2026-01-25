import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Read environment variables from .env file
let supabaseUrl, supabaseKey;

try {
  const envContent = fs.readFileSync('.env', 'utf8');
  const envLines = envContent.split('\n');
  
  for (const line of envLines) {
    if (line.startsWith('VITE_SUPABASE_URL=')) {
      supabaseUrl = line.split('=')[1].trim();
    }
    if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      supabaseKey = line.split('=')[1].trim();
    }
  }
} catch (error) {
  console.error('Error reading .env file:', error.message);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
  console.log('🔍 Checking availability tables in database...\n');

  try {
    // Check if availability table exists
    console.log('1. Checking availability table:');
    const { data: availabilityData, error: availabilityError } = await supabase
      .from('availability')
      .select('*')
      .limit(1);

    if (availabilityError) {
      console.log('   ❌ availability table:', availabilityError.message);
    } else {
      console.log('   ✅ availability table exists');
      console.log('   📊 Sample data:', availabilityData);
    }

    // Check if availability_blocks table exists
    console.log('\n2. Checking availability_blocks table:');
    const { data: blocksData, error: blocksError } = await supabase
      .from('availability_blocks')
      .select('*')
      .limit(1);

    if (blocksError) {
      console.log('   ❌ availability_blocks table:', blocksError.message);
    } else {
      console.log('   ✅ availability_blocks table exists');
      console.log('   📊 Sample data:', blocksData);
    }

    // Check table schema using raw SQL
    console.log('\n3. Checking table schemas:');
    const { data: schemaData, error: schemaError } = await supabase.rpc('exec_sql', {
      sql: `
        SELECT table_name, column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name IN ('availability', 'availability_blocks') 
        AND table_schema = 'public'
        ORDER BY table_name, ordinal_position;
      `
    });

    if (schemaError) {
      console.log('   ❌ Schema check failed:', schemaError.message);
    } else {
      console.log('   📋 Table schemas:', schemaData);
    }

  } catch (error) {
    console.error('❌ Error checking tables:', error);
  }
}

checkTables();