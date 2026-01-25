import { createClient } from '@supabase/supabase-js';

const supabase = createClient('https://hleqspdnjfswrmozjkai.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsZXFzcGRuamZzd3Jtb3pqa2FpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1OTI1MjQsImV4cCI6MjA3MzE2ODUyNH0.WFVv7I5xFdIGsj40ln3Wt4qltMO9fFcmSdKLkoRlvEE');

async function getGardeners() {
  console.log('Fetching gardeners from database...');
  
  const { data, error } = await supabase
    .from('gardener_profiles')
    .select('user_id, full_name, avatar_url')
    .limit(5);
  
  if (error) {
    console.error('Error fetching gardeners:', error);
  } else {
    console.log('Gardeners found:', data);
    if (data && data.length > 0) {
      console.log('First gardener ID:', data[0].user_id);
      console.log('First gardener name:', data[0].full_name);
    }
  }
}

getGardeners();