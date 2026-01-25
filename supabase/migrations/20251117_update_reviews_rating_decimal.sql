-- Actualizar columna rating de reseñas para permitir medias estrellas
-- Cambia el tipo a numeric(2,1) y añade una restricción para pasos de 0.5

ALTER TABLE reviews
  ALTER COLUMN rating TYPE numeric(2,1) USING rating::numeric;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_half_step
  CHECK (
    rating >= 1 AND rating <= 5 AND (rating * 2) = trunc(rating * 2)
  );