-- Seed service images based on existing services created by migrations
INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20cesped.jpeg'
FROM public.services WHERE name ILIKE '%Corte de césped%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/corte%20de%20setos.jpeg'
FROM public.services WHERE name ILIKE '%Recorte de setos%' OR name ILIKE '%Poda de setos%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/fumigacion.jpeg'
FROM public.services WHERE name ILIKE '%Servicios fitosanitarios%' OR name ILIKE '%Tratamientos fitosanitarios%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20arboles.avif'
FROM public.services WHERE name ILIKE '%Poda de árboles%' OR name ILIKE '%Poda de arboles%'
ON CONFLICT (service_id) DO NOTHING;

INSERT INTO public.service_images (service_id, image_url)
SELECT id, 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/service-backgrounds/poda%20de%20plantas.jpeg'
FROM public.services WHERE name ILIKE '%Plantación%' OR name ILIKE '%Poda de plantas%'
ON CONFLICT (service_id) DO NOTHING;


-- ============================================================================
-- JARDINERO DE PRUEBA COMPLETO (solo entorno local)
-- ============================================================================
-- Cuenta permanente para probar disponibilidad, filtrado, precios, reservas y
-- cancelaciones sin tener que reconfigurar nada tras cada `supabase db reset`.
--
--   Jardinero: jardinero.local@test.local / Test123456!
--   Cliente:   cliente.local@test.local   / Test123456!
--
-- Configurado como un profesional real de la Costa del Sol: los 7 servicios activos
-- con tarifas y rendimientos coherentes, horario semanal fijo y reglas de preaviso.
-- ============================================================================

-- OJO: GoTrue falla con "Database error querying schema" si las columnas de token quedan a
-- NULL; espera cadenas vacías. Sin esto el usuario existe pero NO PUEDE INICIAR SESIÓN.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token, email_change,
  email_change_token_new, email_change_token_current,
  phone_change, phone_change_token, reauthentication_token
) VALUES
  ('11111111-aaaa-4aaa-8aaa-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'jardinero.local@test.local', crypt('Test123456!', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Miguel Ángel Ruiz","role":"gardener","requested_role":"gardener"}'::jsonb,
   '', '', '', '', '', '', '', ''),
  ('22222222-bbbb-4bbb-8bbb-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'cliente.local@test.local', crypt('Test123456!', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Laura Fernández","role":"client"}'::jsonb,
   '', '', '', '', '', '', '', ''),
  -- Administrador local: hace falta para probar la cola de incidencias, que decide
  -- devoluciones de dinero. Solo existe en la semilla local; produccion no la ejecuta.
  ('33333333-cccc-4ccc-8ccc-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated',
   'admin.local@test.local', crypt('Test123456!', gen_salt('bf')), now(), now(), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Admin Local","role":"admin"}'::jsonb,
   '', '', '', '', '', '', '', '')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES
  (gen_random_uuid(),'11111111-aaaa-4aaa-8aaa-111111111111','11111111-aaaa-4aaa-8aaa-111111111111',
   '{"sub":"11111111-aaaa-4aaa-8aaa-111111111111","email":"jardinero.local@test.local","email_verified":true}'::jsonb,
   'email', now(), now(), now()),
  (gen_random_uuid(),'22222222-bbbb-4bbb-8bbb-222222222222','22222222-bbbb-4bbb-8bbb-222222222222',
   '{"sub":"22222222-bbbb-4bbb-8bbb-222222222222","email":"cliente.local@test.local","email_verified":true}'::jsonb,
   'email', now(), now(), now()),
  (gen_random_uuid(),'33333333-cccc-4ccc-8ccc-333333333333','33333333-cccc-4ccc-8ccc-333333333333',
   '{"sub":"33333333-cccc-4ccc-8ccc-333333333333","email":"admin.local@test.local","email_verified":true}'::jsonb,
   'email', now(), now(), now())
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (user_id, full_name, phone, address, role) VALUES
  ('11111111-aaaa-4aaa-8aaa-111111111111','Miguel Ángel Ruiz','600112233','Marbella','gardener'),
  ('22222222-bbbb-4bbb-8bbb-222222222222','Laura Fernández','600445566','Nueva Andalucía, Marbella','client'),
  ('33333333-cccc-4ccc-8ccc-333333333333','Admin Local',NULL,NULL,'admin')
ON CONFLICT DO NOTHING;

-- Perfil operativo: Marbella centro, 40 km de radio (cubre Estepona–Fuengirola).
INSERT INTO public.gardener_profiles (
  user_id, full_name, phone, address, city_zone, description,
  experience_years, max_distance, is_available,
  operational_latitude, operational_longitude,
  has_phytosanitary_license, license_verification_status,
  rating, rating_average, rating_count, total_reviews
) VALUES (
  '11111111-aaaa-4aaa-8aaa-111111111111','Miguel Ángel Ruiz','600112233',
  'Avenida Ricardo Soriano, Marbella','Marbella',
  'Jardinero profesional con 12 años de experiencia en la Costa del Sol. Mantenimiento integral, poda de palmeras y tratamientos fitosanitarios con carné aplicador.',
  12, 40, true, 36.5101, -4.8824, true, 'approved', NULL, 0, 0, 0
) ON CONFLICT (user_id) DO NOTHING;

-- Solicitud ya APROBADA. Un jardinero real aprobado por el admin tiene las dos cosas:
-- la solicitud en estado 'approved' y el perfil operativo. Sembrar solo el perfil deja la
-- cuenta a medias y cualquier pantalla que mire la solicitud (App.tsx toUiStatus, /status,
-- el panel de admin) la ve como "sin solicitar" y empuja al formulario de /apply.
INSERT INTO public.gardener_applications (
  user_id, status, full_name, phone, email, city_zone,
  services, tools_available, experience_years, experience_range,
  worked_for_companies, can_prove, experience_description,
  test_grass_frequency, test_hedge_season, test_pest_action,
  certification_text, declaration_truth, accept_terms,
  submitted_at, reviewed_at, review_comment
) VALUES (
  '11111111-aaaa-4aaa-8aaa-111111111111','approved','Miguel Ángel Ruiz','600112233',
  'jardinero.local@test.local','Marbella',
  ARRAY['Corte de césped','Poda de setos','Poda de árboles','Poda de palmeras',
        'Poda de arbustos','Desbroce','Tratamientos fitosanitarios'],
  ARRAY['Cortacésped','Desbrozadora','Motosierra','Cortasetos','Atomizador','Vehículo propio'],
  12,'>5', true, true,
  'Doce años en mantenimiento integral de jardines en la Costa del Sol, con carné de aplicador de fitosanitarios.',
  'semana','invierno','Identificar la plaga antes de tratar y aplicar el producto autorizado en la dosis mínima eficaz.',
  'Carné de aplicador de productos fitosanitarios nivel cualificado.',
  true, true, now(), now(), 'Cuenta de pruebas local aprobada automáticamente por el seed.'
) ON CONFLICT (user_id) DO UPDATE SET
  status = 'approved',
  reviewed_at = now(),
  review_comment = EXCLUDED.review_comment;

-- ---------------------------------------------------------------------------
-- Tarifas de los 7 servicios. Precios de mercado de la Costa del Sol (2026):
-- rendimientos realistas (lo que rinde una jornada) y mínimos que cubren el
-- desplazamiento. Todos los recargos configurados para poder probarlos.
-- ---------------------------------------------------------------------------

-- 1) CORTE DE CÉSPED — 0,18 €/m², 150 m²/h, mínimo 45 €
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'area', 0.18, 'EUR', true, '{
  "pricing_method": "per_quantity",
  "price_per_m2": 0.18,
  "precioPorHora": 28,
  "yield_m2_per_hour": 150,
  "minimum_price": 45,
  "condition_surcharges": { "descuidado": 20, "muy_descuidado": 50 },
  "waste_removal": { "percentage": 15 }
}'::jsonb
FROM public.services WHERE name ILIKE '%Corte de césped%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- 2) PODA DE SETOS — por metro lineal y banda de altura (incluye 4-6 m)
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'area', 3.50, 'EUR', true, '{
  "pricing_method": "per_quantity",
  "pricing_matrix": { "0-2m": 3.5, "2-4m": 5.5, "4-6m": 8.0 },
  "yield_ml_per_hour": { "0-2m": 25, "2-4m": 15, "4-6m": 8 },
  "precioPorHora": 30,
  "minimum_price": 50,
  "condition_surcharges": { "media": 20, "alta": 50 },
  "waste_removal": { "percentage": 15 }
}'::jsonb
FROM public.services WHERE name ILIKE '%Poda de setos%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- 3) PODA DE ÁRBOLES — precio por árbol (este servicio solo admite per_quantity)
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'count', 35, 'EUR', true, '{
  "pricing_method": "per_quantity",
  "formacion":   { "small": 35, "medium": 60,  "large": 110 },
  "estructural": { "small": 45, "medium": 80,  "large": 150 },
  "yield_units_per_hour": {
    "formacion":   { "small": 2.5, "medium": 1.5, "large": 0.8 },
    "estructural": { "small": 2.0, "medium": 1.2, "large": 0.6 }
  },
  "difficultyIncrease": 30,
  "wasteRemovalMultiplier": 15,
  "minimumPrice": 60
}'::jsonb
FROM public.services WHERE name ILIKE '%Poda de árboles%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- 4) PODA DE PALMERAS — todas las especies y bandas cubiertas, con extras
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'count', 45, 'EUR', true, '{
  "pricing_method": "per_quantity",
  "height_prices": {
    "Phoenix canariensis":           { "0-4": 45, "4-10": 90, ">10": 150 },
    "Phoenix dactylifera":           { "0-5": 50, "5-10": 95, "10-15": 160, ">15": 220 },
    "Washingtonia robusta/filifera": { "0-4": 40, "4-12": 85, "12-20": 140, ">20": 200 },
    "Syagrus romanzoffiana":         { "0-5": 45, "5-10": 85, ">10": 140 },
    "Trachycarpus fortunei":         { "0-3": 35, "3-6": 60, ">6": 95 },
    "Roystonea regia":               { "0-6": 55, ">6": 120 }
  },
  "yield_units_per_hour": {
    "Phoenix canariensis":           { "0-4": 1.5, "4-10": 0.8, ">10": 0.5 },
    "Phoenix dactylifera":           { "0-5": 1.4, "5-10": 0.8, "10-15": 0.5, ">15": 0.35 },
    "Washingtonia robusta/filifera": { "0-4": 1.6, "4-12": 0.9, "12-20": 0.55, ">20": 0.4 },
    "Syagrus romanzoffiana":         { "0-5": 1.5, "5-10": 0.9, ">10": 0.6 },
    "Trachycarpus fortunei":         { "0-3": 2.0, "3-6": 1.2, ">6": 0.8 },
    "Roystonea regia":               { "0-6": 1.2, ">6": 0.7 }
  },
  "precioPorHora": 35,
  "condition_surcharges": { "normal": 0, "descuidado": 20, "muy_descuidado": 50 },
  "waste_removal": { "percentage": 15 },
  "phytosanitary": 18,
  "trunk_finish": 20,
  "access_difficulty": 25,
  "minimum_price": 60
}'::jsonb
FROM public.services WHERE name ILIKE '%Poda de palmeras%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- 5) PODA DE PLANTAS Y ARBUSTOS — €/m² por tamaño
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'area', 4.50, 'EUR', true, '{
  "pricing_method": "per_quantity",
  "prices_per_m2": { "pequeñas": 4.5, "medianas": 6.5, "grandes": 9.0 },
  "yield_m2_per_hour": { "pequeñas": 12, "medianas": 8, "grandes": 5 },
  "precioPorHora": 30,
  "condition_surcharges": { "media": 20, "alta": 50 },
  "waste_removal": { "percentage": 15 },
  "minimum_price": 45
}'::jsonb
FROM public.services WHERE name ILIKE '%Poda de plantas y arbustos%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- 6) DESBROCE — €/m² + herbicida opcional (requiere licencia, que este jardinero tiene)
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'area', 0.35, 'EUR', true, '{
  "precio_desbroce_m2": 0.35,
  "precio_herbicida_m2": 0.15,
  "yield_m2_per_hour": 120,
  "suplementos": { "dificultad_media": 20, "dificultad_alta": 50, "retirada_restos": 20 },
  "importe_minimo": 60
}'::jsonb
FROM public.services WHERE name ILIKE '%Desbroce%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- 7) SERVICIOS FITOSANITARIOS — 4 tratamientos activos, incluida endoterapia
INSERT INTO public.gardener_service_prices (gardener_id, service_id, unit_type, price_per_unit, currency, active, additional_config)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, id, 'area', 0.12, 'EUR', true, '{
  "version": "phytosanitary_v2",
  "tratamientos_activos": ["insecticida", "fungicida", "ecologico_preventivo", "endoterapia"],
  "detailed_pricing": {
    "cesped":   { "minimo": 50, "preventivo": 0.12, "curativo": 0.20 },
    "setos":    { "minimo": 50, "bajos_preventivo": 1.2, "bajos_curativo": 1.8, "altos_preventivo": 1.8, "altos_curativo": 2.6 },
    "palmeras": { "minimo": 60,
                  "pequenas_preventivo": 25, "pequenas_curativo": 40, "pequenas_cirugia": 90,
                  "medianas_preventivo": 35, "medianas_curativo": 55, "medianas_cirugia": 120,
                  "altas_preventivo": 50,    "altas_curativo": 75,    "altas_cirugia": 160 },
    "arboles":  { "minimo": 50,
                  "pequenos_preventivo": 15, "pequenos_curativo": 25,
                  "medianos_preventivo": 25, "medianos_curativo": 40,
                  "grandes_preventivo": 40,  "grandes_curativo": 65 },
    "plantas":  { "minimo": 45,
                  "pequenas_preventivo": 0.15, "pequenas_curativo": 0.25,
                  "medianas_preventivo": 0.20, "medianas_curativo": 0.32,
                  "grandes_preventivo": 0.28,  "grandes_curativo": 0.45 }
  },
  "palmeras": { "endoterapia": { "precio_unico": 65 } },
  "yields": {
    "cesped_m2_per_hour": 400, "setos_ml_per_hour": 60, "palmeras_units_per_hour": 4,
    "arboles_units_per_hour": 5, "plantas_m2_per_hour": 300, "endoterapia_units_per_hour": 3
  },
  "pricing_modifiers": {
    "eco": { "percentage": 10 },
    "combo": { "two_treatments_percentage": 15, "three_plus_treatments_percentage": 25 }
  },
  "precioPorHora": 35,
  "importe_minimo": 50,
  "minimum_price": 50,
  "minimum_fee": 50
}'::jsonb
FROM public.services WHERE name ILIKE '%fitosanitario%'
ON CONFLICT (gardener_id, service_id) DO UPDATE SET active = true, additional_config = EXCLUDED.additional_config;

-- ---------------------------------------------------------------------------
-- Horario semanal fijo y reglas de disponibilidad
-- ---------------------------------------------------------------------------
-- Lunes a viernes 08:00–18:00 y sábados 09:00–14:00 (jornada real de jardinería
-- en la Costa del Sol; domingo libre, útil además para probar que un domingo NO
-- ofrece huecos).
INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time)
SELECT '11111111-aaaa-4aaa-8aaa-111111111111'::uuid, d, '08:00'::time, '18:00'::time
FROM generate_series(1, 5) AS d
ON CONFLICT DO NOTHING;

INSERT INTO public.recurring_schedules (gardener_id, day_of_week, start_time, end_time)
VALUES ('11111111-aaaa-4aaa-8aaa-111111111111'::uuid, 6, '09:00'::time, '14:00'::time)
ON CONFLICT DO NOTHING;

-- Preaviso mínimo de 12 h: suficiente para ser realista (nadie acepta un trabajo
-- para dentro de 10 minutos) sin impedir probar reservas del día siguiente.
INSERT INTO public.recurring_availability_settings (gardener_id, weeks_to_maintain, min_notice_hours)
VALUES ('11111111-aaaa-4aaa-8aaa-111111111111'::uuid, 4, 12)
ON CONFLICT (gardener_id) DO UPDATE
  SET weeks_to_maintain = EXCLUDED.weeks_to_maintain,
      min_notice_hours = EXCLUDED.min_notice_hours;

-- Huecos concretos de las próximas 4 semanas, derivados del horario de arriba.
-- (La app los regenera sola con generate_recurring_slots; esto garantiza que haya
-- disponibilidad desde el primer momento tras un `db reset`.)
INSERT INTO public.availability (gardener_id, date, start_time, end_time, is_available)
SELECT
  '11111111-aaaa-4aaa-8aaa-111111111111'::uuid,
  d::date,
  (h || ':00')::time,
  ((h + 1) || ':00')::time,
  true
FROM generate_series(CURRENT_DATE, CURRENT_DATE + 28, interval '1 day') AS d
CROSS JOIN generate_series(8, 17) AS h
WHERE EXTRACT(DOW FROM d) BETWEEN 1 AND 5
UNION ALL
SELECT
  '11111111-aaaa-4aaa-8aaa-111111111111'::uuid,
  d::date,
  (h || ':00')::time,
  ((h + 1) || ':00')::time,
  true
FROM generate_series(CURRENT_DATE, CURRENT_DATE + 28, interval '1 day') AS d
CROSS JOIN generate_series(9, 13) AS h
WHERE EXTRACT(DOW FROM d) = 6
ON CONFLICT DO NOTHING;
