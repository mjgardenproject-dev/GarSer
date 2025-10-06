import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read environment variables from .env file
let supabaseUrl, supabaseKey;
try {
  const envContent = readFileSync('.env', 'utf8');
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
  console.error('Error reading .env file:', error);
}

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkBookingsStructure() {
  try {
    console.log('Checking bookings table structure...');
    
    // Get a sample booking to see the actual structure
    const { data: sampleBooking, error: sampleError } = await supabase
      .from('bookings')
      .select('*')
      .limit(1);
    
    if (sampleError) {
      console.error('Error fetching sample booking:', sampleError);
    } else {
      console.log('Sample booking structure:', sampleBooking);
    }
    
    // Try to get bookings with different relationship approaches
    console.log('\nTrying different relationship queries...');
    
    // Test 1: Simple query without relationships
    const { data: simple, error: simpleError } = await supabase
      .from('bookings')
      .select('*')
      .limit(1);
    
    console.log('Simple query result:', { data: simple, error: simpleError });
    
    // Test 2: Try with services relationship
    const { data: withServices, error: servicesError } = await supabase
      .from('bookings')
      .select('*, services(*)')
      .limit(1);
    
    console.log('With services relationship:', { data: withServices, error: servicesError });
    
    // Test 3: Try to find the correct profile relationship
    const { data: withProfiles, error: profilesError } = await supabase
      .from('bookings')
      .select('*, profiles(*)')
      .limit(1);
    
    console.log('With profiles relationship:', { data: withProfiles, error: profilesError });
    
    // Test 4: Check if there's a different way to reference profiles
    const { data: clientProfile, error: clientError } = await supabase
      .from('bookings')
      .select('*, client_profile:profiles!client_id(*)')
      .limit(1);
    
    console.log('With client_profile relationship:', { data: clientProfile, error: clientError });
    
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

checkBookingsStructure();