/**
 * Huecos para la foto de cada especie de palmera en el formulario manual (D-06, D-13).
 *
 * Las fotos las aportará el usuario más adelante. Mientras el valor sea `null`, la especie se
 * enseña sin imagen (nombre común + latín), así que el formulario funciona igual con o sin ellas.
 *
 * Cuando llegue una foto:
 *   1. Copiarla a `public/images/palmeras/` con el nombre indicado al lado (cuadrada, mínimo
 *      160 × 160 px, `.webp` o `.jpg`, menos de 60 KB).
 *   2. Poner aquí su ruta pública, p. ej. `'/images/palmeras/palmera-canaria.webp'`.
 * No hace falta tocar nada más: ni el schema ni lo que se envía (la clave es el `value` de la
 * especie, que no cambia). `palmSpeciesPhotos.test.ts` comprueba que cada especie tiene su hueco y
 * que cada ruta puesta apunta a un archivo que existe.
 */
export const PALM_SPECIES_PHOTOS: Record<string, string | null> = {
  'Phoenix canariensis': null, // palmera-canaria
  'Phoenix dactylifera': null, // palmera-datilera
  'Washingtonia robusta/filifera': null, // washingtonia
  'Syagrus romanzoffiana': null, // pindo
  'Trachycarpus fortunei': null, // palmera-de-molino
  'Roystonea regia': null, // palmera-real
};

export const PALM_SPECIES_PHOTOS_DIR = '/images/palmeras/';
