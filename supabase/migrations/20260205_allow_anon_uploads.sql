-- Permitir a usuarios anónimos subir fotos a la carpeta drafts/anon/
-- Esto es necesario para el flujo de reserva sin autenticación

-- 1. Política de inserción para anónimos
create policy "booking_photos_insert_anon"
on storage.objects for insert to anon
with check (
  bucket_id = 'booking-photos'
  and name like 'drafts/anon/%'
);

-- 2. Política de lectura para anónimos (opcional, pero útil para verificar la subida)
create policy "booking_photos_select_anon"
on storage.objects for select to anon
using (
  bucket_id = 'booking-photos'
  and name like 'drafts/anon/%'
);
