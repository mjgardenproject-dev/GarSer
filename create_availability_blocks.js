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

async function createAvailabilityBlocksTable() {
  console.log('🚀 Creating availability_blocks table...\n');

  try {
    // SQL to create the availability_blocks table
    const createTableSQL = `
      -- Crear tabla de bloques de disponibilidad (reemplaza la tabla availability existente)
      CREATE TABLE IF NOT EXISTS availability_blocks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        gardener_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
        date date NOT NULL,
        hour_block integer NOT NULL, -- 0-23 representando las horas del día
        is_available boolean DEFAULT true,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now(),
        UNIQUE(gardener_id, date, hour_block)
      );
    `;

    // Execute the SQL using rpc if available, or try direct execution
    console.log('📝 Executing SQL to create availability_blocks table...');
    
    // Try to execute the SQL directly
    const { data, error } = await supabase.rpc('exec_sql', {
      sql: createTableSQL
    });

    if (error) {
      console.log('❌ RPC method failed, trying alternative approach...');
      console.log('Error:', error.message);
      
      // Alternative: Try to create the table by testing if it works
      const { data: testData, error: testError } = await supabase
        .from('availability_blocks')
        .select('*')
        .limit(1);

      if (testError && testError.message.includes('does not exist')) {
        console.log('❌ Table definitely does not exist. Manual creation needed.');
        console.log('\n📋 Please execute this SQL manually in your Supabase dashboard:');
        console.log('=' .repeat(60));
        console.log(createTableSQL);
        console.log('=' .repeat(60));
      } else {
        console.log('✅ Table seems to exist or was created successfully!');
      }
    } else {
      console.log('✅ Table created successfully!');
      console.log('📊 Result:', data);
    }

    // Verify the table was created
    console.log('\n🔍 Verifying table creation...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('availability_blocks')
      .select('*')
      .limit(1);

    if (verifyError) {
      console.log('❌ Verification failed:', verifyError.message);
    } else {
      console.log('✅ Table verified successfully!');
      console.log('📊 Sample data:', verifyData);
    }

  } catch (error) {
    console.error('❌ Error creating table:', error);
  }
}

createAvailabilityBlocksTable();