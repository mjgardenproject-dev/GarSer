// Marketing del profesional (2026-10-20): catálogo de materiales y sus tamaños. Todo lo que se
// descarga lleva el QR a su perfil de GarSer y la marca de GarSer. Sin precios y sin teléfono:
// la reserva va siempre por GarSer.

export type MaterialId =
  | 'social'
  | 'business_card'
  | 'next_visit_card'
  | 'mailbox_flyer'
  | 'van_vinyl'
  | 'tear_off_poster'
  | 'qr_stickers'
  | 'fence_sign'
  | 'qr_code';

export interface MaterialSize {
  id: string;
  label: string;
  /** Tamaño y para qué plataforma o uso. */
  detail: string;
  width: number;
  height: number;
  /** Solo en impresión: resolución a la que se dibuja (puede bajar para caber, ver safeDpi). */
  dpi?: number;
}

export interface MarketingMaterial {
  id: MaterialId;
  title: string;
  /** Para qué sirve, en una frase. */
  use: string;
  /** Un consejo para sacarle partido. */
  tip: string;
  /** Cómo imprimirlo (solo materiales impresos). */
  printNote?: string;
  kind: 'social' | 'print' | 'qr';
  sizes: MaterialSize[];
  /** Qué se puede personalizar en este material. */
  options: { headline: boolean; services: boolean; rating: boolean; subtitle: boolean };
}

/**
 * Un canvas más grande que ~16,7 Mpx no se puede crear en un iPhone (Safari lo deja en blanco). Se
 * deja margen: ningún material pasa de 16 Mpx.
 */
export const MAX_CANVAS_PIXELS = 16_000_000;

export const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

/** La resolución más alta (hasta `dpi`) a la que ese tamaño cabe en MAX_CANVAS_PIXELS. */
export function safeDpi(widthMm: number, heightMm: number, dpi: number, maxPixels = MAX_CANVAS_PIXELS): number {
  let value = dpi;
  while (value > 1 && mmToPx(widthMm, value) * mmToPx(heightMm, value) > maxPixels) {
    value -= 1;
  }
  return value;
}

function printSize(id: string, label: string, use: string, widthMm: number, heightMm: number, dpi: number): MaterialSize {
  const finalDpi = safeDpi(widthMm, heightMm, dpi);
  const cm = (mm: number) => (mm % 10 === 0 ? String(mm / 10) : (mm / 10).toFixed(1).replace('.', ','));
  return {
    id,
    label,
    detail: `${cm(widthMm)} × ${cm(heightMm)} cm · ${use}`,
    width: mmToPx(widthMm, finalDpi),
    height: mmToPx(heightMm, finalDpi),
    dpi: finalDpi,
  };
}

/** Medidas de impresión, en mm. */
export const PRINT = {
  card: { w: 85, h: 55 },
  a4: { w: 210, h: 297 },
  a5: { w: 148, h: 210 },
  dl: { w: 99, h: 210 },
  a3: { w: 297, h: 420 },
  sticker: { w: 50, h: 50 },
} as const;

const SOCIAL_SIZES: MaterialSize[] = [
  { id: 'portrait', label: 'Vertical', detail: '1080 × 1350 · Instagram y Facebook, la que más se ve', width: 1080, height: 1350 },
  { id: 'square', label: 'Cuadrada', detail: '1080 × 1080 · Instagram y Facebook', width: 1080, height: 1080 },
  { id: 'story', label: 'Historia', detail: '1080 × 1920 · Historias y estados de WhatsApp', width: 1080, height: 1920 },
  { id: 'landscape', label: 'Horizontal', detail: '1200 × 630 · Facebook, X y grupos de vecinos', width: 1200, height: 630 },
];

const CARD_SIZES: MaterialSize[] = [
  printSize('sheet', 'Hoja A4 con 10', 'para imprimir en casa y recortar', PRINT.a4.w, PRINT.a4.h, 300),
  printSize('card', 'Tarjeta suelta', 'para la imprenta (8,5 × 5,5 cm)', PRINT.card.w, PRINT.card.h, 300),
];

export const MARKETING_MATERIALS: MarketingMaterial[] = [
  {
    id: 'social',
    title: 'Flyer para redes',
    use: 'Tu anuncio para Instagram, Facebook y los estados de WhatsApp.',
    tip: 'Las historias duran 24 horas: vuelve a subirlo cada semana.',
    kind: 'social',
    sizes: SOCIAL_SIZES,
    options: { headline: true, services: true, rating: true, subtitle: true },
  },
  {
    id: 'business_card',
    title: 'Tarjetas de visita',
    use: 'Para dárselas a cada vecino que te pregunte.',
    tip: 'Llévalas siempre encima: en la calle te preguntan más de lo que parece.',
    printNote: 'Imprime al 100 % (tamaño real) en cartulina de 300 g y corta por las marcas.',
    kind: 'print',
    sizes: CARD_SIZES,
    options: { headline: false, services: true, rating: false, subtitle: true },
  },
  {
    id: 'next_visit_card',
    title: 'Tarjeta «Próxima visita»',
    use: 'Para dejarla al terminar cada trabajo.',
    tip: 'Es la forma más fácil de que te vuelvan a llamar: el cliente escanea y reserva la próxima.',
    printNote: 'Imprime al 100 % en cartulina de 300 g y corta por las marcas.',
    kind: 'print',
    sizes: CARD_SIZES,
    options: { headline: false, services: false, rating: false, subtitle: false },
  },
  {
    id: 'mailbox_flyer',
    title: 'Flyer para buzonear',
    use: 'Con más información: tus servicios, cómo funciona y tu QR.',
    tip: 'Buzonea las calles donde ya trabajas: tus vecinos ven tu trabajo cada día.',
    printNote: 'Papel de 135–170 g. En una imprenta, 500 flyers A5 salen baratos.',
    kind: 'print',
    sizes: [
      printSize('a5', 'A5', 'el más habitual', PRINT.a5.w, PRINT.a5.h, 300),
      printSize('dl', 'DL (alargado)', 'cabe en cualquier buzón', PRINT.dl.w, PRINT.dl.h, 300),
    ],
    options: { headline: true, services: true, rating: true, subtitle: true },
  },
  {
    id: 'van_vinyl',
    title: 'Vinilo para la furgoneta',
    use: 'Tu furgoneta pasa por cientos de casas cada semana.',
    tip: 'Pon el lateral a la altura de los ojos: el QR tiene que poder escanearse desde la acera.',
    printNote: 'Imagen a tamaño real. Pide en la imprenta vinilo impreso con laminado.',
    kind: 'print',
    sizes: [
      printSize('side', 'Lateral', 'puertas o costado', 1000, 500, 100),
      printSize('rear', 'Portón', 'puerta trasera', 600, 300, 150),
    ],
    options: { headline: false, services: true, rating: false, subtitle: true },
  },
  {
    id: 'tear_off_poster',
    title: 'Cartel con pestañas',
    use: 'Para comercios, portales y tablones: quien lo necesita se lleva una pestaña.',
    tip: 'Pídelo en la ferretería, la frutería o el portal de tus clientes.',
    printNote: 'Imprime en A4 al 100 % y corta las líneas de puntos de las pestañas.',
    kind: 'print',
    sizes: [printSize('a4', 'A4', 'con 8 pestañas para arrancar', PRINT.a4.w, PRINT.a4.h, 300)],
    options: { headline: true, services: true, rating: false, subtitle: true },
  },
  {
    id: 'qr_stickers',
    title: 'Pegatinas con QR',
    use: 'Para tus facturas, tus herramientas o el buzón de tus clientes.',
    tip: 'Una en cada factura: el cliente ya tiene a mano cómo volver a reservarte.',
    printNote: 'Imprime al 100 % en papel adhesivo A4 y corta por las marcas.',
    kind: 'print',
    sizes: [printSize('sheet', 'Hoja A4 con 15', 'pegatinas de 5 × 5 cm', PRINT.a4.w, PRINT.a4.h, 300)],
    options: { headline: false, services: false, rating: false, subtitle: false },
  },
  {
    id: 'fence_sign',
    title: 'Cartel para la valla',
    use: '«Este jardín lo cuida…», para poner mientras trabajas.',
    tip: 'Pide permiso al cliente: los vecinos ven el resultado y preguntan.',
    printNote: 'A3 en plástico o cartón pluma para que aguante a la intemperie.',
    kind: 'print',
    sizes: [printSize('a3', 'A3', 'cartel para exterior', PRINT.a3.w, PRINT.a3.h, 300)],
    options: { headline: false, services: true, rating: false, subtitle: true },
  },
  {
    id: 'qr_code',
    title: 'Tu QR',
    use: 'Solo el código, para ponerlo donde quieras.',
    tip: 'Pégalo en tus presupuestos y facturas en papel.',
    kind: 'qr',
    sizes: [{ id: 'qr', label: 'QR', detail: '1200 × 1200 · para imprimir donde quieras', width: 1200, height: 1200 }],
    options: { headline: false, services: false, rating: false, subtitle: false },
  },
];

export function getMaterial(id: MaterialId): MarketingMaterial {
  const material = MARKETING_MATERIALS.find((m) => m.id === id);
  if (!material) throw new Error(`Material desconocido: ${id}`);
  return material;
}

/** Los materiales para imprimir, en el orden en que se enseñan. */
export const PRINT_MATERIAL_IDS: MaterialId[] = [
  'business_card',
  'next_visit_card',
  'mailbox_flyer',
  'van_vinyl',
  'tear_off_poster',
  'qr_stickers',
  'fence_sign',
];
