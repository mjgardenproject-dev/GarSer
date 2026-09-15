-- Update the hedges service image URL to point to the new marketing asset
UPDATE service_images
SET image_url = 'https://hleqspdnjfswrmozjkai.supabase.co/storage/v1/object/public/marketing-assets/home/services/hedges.webp'
WHERE service_id IN ('c8e293ed-b772-4da2-a14b-eeb20d316f20', '31357ccd-e0ba-487e-bdfd-5958715303e6');
