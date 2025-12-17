-- Ensure bucket exists (idempotent)
insert into storage.buckets (id, name, public)
values ('booking-photos', 'booking-photos', false)
on conflict (id) do nothing;

-- Policies for authenticated users to upload and read booking photos
drop policy if exists "booking_photos_insert_auth" on storage.objects;
drop policy if exists "booking_photos_select_auth" on storage.objects;

create policy "booking_photos_insert_auth"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'booking-photos'
  and name like ('drafts/' || auth.uid()::text || '/%')
);

create policy "booking_photos_select_auth"
on storage.objects for select to authenticated
using (
  bucket_id = 'booking-photos'
);
