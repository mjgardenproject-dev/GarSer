-- gardener_applications
alter table public.gardener_applications enable row level security;

create policy apps_select_own on public.gardener_applications for select
  to authenticated using (user_id = auth.uid());

create policy apps_insert_own on public.gardener_applications for insert
  to authenticated with check (user_id = auth.uid());

create policy apps_update_own on public.gardener_applications for update
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy apps_admin_all on public.gardener_applications for all
  to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- gardener_profiles
alter table public.gardener_profiles enable row level security;

create policy gp_select_own on public.gardener_profiles for select
  to authenticated using (user_id = auth.uid());

create policy gp_admin_insert on public.gardener_profiles for insert
  to authenticated with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy gp_admin_update on public.gardener_profiles for update
  to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- profiles (actualizar rol)
alter table public.profiles enable row level security;

create policy profiles_select_self on public.profiles for select
  to authenticated using (id = auth.uid());

create policy profiles_admin_update_role on public.profiles for update
  to authenticated using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Storage policies para bucket 'flyers'
-- Lectura pública (opcional)
create policy flyers_public_read on storage.objects for select
  to public using (bucket_id = 'flyers');

-- Escritura y actualización por admin
create policy flyers_admin_insert on storage.objects for insert
  to authenticated with check (
    bucket_id = 'flyers' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy flyers_admin_update on storage.objects for update
  to authenticated using (
    bucket_id = 'flyers' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  ) with check (
    bucket_id = 'flyers' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );
