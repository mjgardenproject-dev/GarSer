import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envContent = fs.readFileSync('.env', 'utf8');
let supabaseUrl, supabaseKey;

for (const line of envContent.split('\n')) {
  if (line.startsWith('VITE_SUPABASE_URL=')) supabaseUrl = line.split('=')[1].trim();
  if (line.startsWith('VITE_SUPABASE_ANON_KEY=')) supabaseKey = line.split('=')[1].trim();
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const sql = `
CREATE OR REPLACE FUNCTION prevent_overlapping_bookings()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'confirmed' THEN
    IF EXISTS (
      SELECT 1 FROM bookings
      WHERE gardener_id = NEW.gardener_id
        AND date = NEW.date
        AND status = 'confirmed'
        AND id != NEW.id
        AND (
          (CAST(split_part(start_time, ':', 1) AS INTEGER) < CAST(split_part(NEW.start_time, ':', 1) AS INTEGER) + NEW.duration_hours)
          AND 
          (CAST(split_part(start_time, ':', 1) AS INTEGER) + duration_hours > CAST(split_part(NEW.start_time, ':', 1) AS INTEGER))
        )
    ) THEN
      RAISE EXCEPTION 'El horario ya ha sido reservado por otro cliente.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_overlapping_bookings ON bookings;
CREATE TRIGGER trg_prevent_overlapping_bookings
BEFORE UPDATE ON bookings
FOR EACH ROW
EXECUTE FUNCTION prevent_overlapping_bookings();

DROP TRIGGER IF EXISTS trg_prevent_overlapping_bookings_insert ON bookings;
CREATE TRIGGER trg_prevent_overlapping_bookings_insert
BEFORE INSERT ON bookings
FOR EACH ROW
EXECUTE FUNCTION prevent_overlapping_bookings();
`;
  const { data, error } = await supabase.rpc('exec_sql', { sql });
  console.log(error ? error : 'Trigger applied');
}
run();