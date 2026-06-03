-- Bucket publico para imagenes de marketing y landing pages.
-- Los archivos se sustituyen desde Supabase Studio o por futuras herramientas admin.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'marketing-assets',
  'marketing-assets',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "marketing_assets_admin_select" on storage.objects;
drop policy if exists "marketing_assets_admin_insert" on storage.objects;
drop policy if exists "marketing_assets_admin_update" on storage.objects;
drop policy if exists "marketing_assets_admin_delete" on storage.objects;

create policy "marketing_assets_admin_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "marketing_assets_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "marketing_assets_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
)
with check (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

create policy "marketing_assets_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'marketing-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = 'admin'
  )
);

-- Contrato de paths para reemplazar imagenes sin tocar codigo:
-- home/hero-mobile.webp
-- home/hero-desktop.webp
-- home/services/lawn.webp
-- home/services/hedges.webp
-- home/services/trees.webp
-- home/services/palms.webp
-- home/services/weeding.webp
-- home/services/phyto.webp
-- home/coverage/costa-del-sol.webp
-- home/marbella-highlight.webp
-- marbella/hero.webp
-- marbella/highlight.webp
-- gardeners/hero.webp
-- gardeners/process.webp
-- shared/og/home.webp
-- shared/og/marbella.webp
-- shared/og/gardeners.webp
