-- Enforce definitive storage-first references for booking media and prevent duplicate rows.

UPDATE public.booking_media
SET media_url = NULLIF(BTRIM(media_url), ''),
    storage_bucket = NULLIF(BTRIM(storage_bucket), ''),
    storage_path = NULLIF(BTRIM(storage_path), '');

WITH ranked_storage_rows AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY booking_id, storage_bucket, storage_path
      ORDER BY created_at ASC, id ASC
    ) AS row_num
  FROM public.booking_media
  WHERE storage_bucket IS NOT NULL
    AND storage_path IS NOT NULL
)
DELETE FROM public.booking_media AS bm
USING ranked_storage_rows AS ranked
WHERE bm.id = ranked.id
  AND ranked.row_num > 1;

ALTER TABLE public.booking_media
  ALTER COLUMN media_url DROP NOT NULL;

ALTER TABLE public.booking_media
  DROP CONSTRAINT IF EXISTS booking_media_storage_pair_chk;

ALTER TABLE public.booking_media
  ADD CONSTRAINT booking_media_storage_pair_chk
  CHECK (
    (storage_bucket IS NULL AND storage_path IS NULL)
    OR (storage_bucket IS NOT NULL AND storage_path IS NOT NULL)
  );

ALTER TABLE public.booking_media
  DROP CONSTRAINT IF EXISTS booking_media_no_draft_storage_refs_chk;

ALTER TABLE public.booking_media
  ADD CONSTRAINT booking_media_no_draft_storage_refs_chk
  CHECK (
    storage_path IS NULL
    OR storage_path !~* '^drafts/'
  );

CREATE UNIQUE INDEX IF NOT EXISTS booking_media_booking_storage_key
  ON public.booking_media (booking_id, storage_bucket, storage_path);
