import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

function readLocalEnv() {
  if (!fs.existsSync('.env')) {
    return {};
  }

  const envVars = {};
  const envContent = fs.readFileSync('.env', 'utf8');
  envContent.split('\n').forEach((line) => {
    const [key, ...rest] = line.split('=');
    if (!key || rest.length === 0) return;
    envVars[key.trim()] = rest.join('=').trim().replace(/^["]|["]$/g, '');
  });
  return envVars;
}

const envVars = readLocalEnv();
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || envVars.SUPABASE_URL || envVars.VITE_SUPABASE_URL;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error('❌ Missing SUPABASE_URL (or VITE_SUPABASE_URL for local fallback).');
  process.exit(1);
}

if (!supabaseServiceKey) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY.');
  console.error('ℹ️  Use an admin-only environment variable for this script. Never expose a service role key with a VITE_ prefix.');
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

    console.log(`📦 Creating bucket '${bucketName}' (private)...`);
    const { error: createError } = await supabase.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    });

    if (createError) {
      console.error('❌ Error creating bucket:', createError.message);
      process.exit(1);
    }

    console.log(`🎉 Bucket '${bucketName}' created as private.`);
    console.log('   Booking media must be served via signed URLs, never public object URLs.');
    process.exit(0);
  } catch (err) {
    console.error('💥 Unexpected error:', err);
    process.exit(1);
  }
}

ensureBucket();
