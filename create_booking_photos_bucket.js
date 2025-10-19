import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Read environment variables from .env file
const envContent = fs.readFileSync('.env', 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) {
    envVars[key.trim()] = value.trim().replace(/^["]|["]$/g, '');
  }
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseServiceKey = envVars.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ Missing VITE_SUPABASE_URL in .env');
  process.exit(1);
}

if (!supabaseServiceKey) {
  console.error('❌ Missing VITE_SUPABASE_SERVICE_ROLE_KEY in .env');
  console.error('ℹ️  Add your Supabase service role key to .env to manage Storage buckets.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function ensureBucket() {
  const bucketName = 'booking-photos';

  try {
    console.log(`🔍 Checking buckets...`);
    const { data: buckets, error: listError } = await supabase.storage.listBuckets();
    if (listError) {
      console.error('❌ Error listing buckets:', listError.message);
      process.exit(1);
    }

    const exists = (buckets || []).some(b => (b.name || b.id) === bucketName);
    if (exists) {
      console.log(`✅ Bucket '${bucketName}' already exists.`);
      process.exit(0);
    }

    console.log(`📦 Creating bucket '${bucketName}' (public)...`);
    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: true,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });

    if (createError) {
      console.error('❌ Error creating bucket:', createError.message);
      process.exit(1);
    }

    console.log(`🎉 Bucket '${bucketName}' created and set to public.`);
    console.log('   Use this bucket for AI photo analysis and booking photos.');
    process.exit(0);
  } catch (err) {
    console.error('💥 Unexpected error:', err);
    process.exit(1);
  }
}

ensureBucket();