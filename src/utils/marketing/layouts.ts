import { mmToPx, PRINT, type MaterialId } from './materials';

// Marketing del profesional: dónde va cada pieza de cada material, en píxeles del lienzo final.
// Función pura (sin canvas): el dibujo (renderMaterial.ts) solo pinta dentro de estas cajas, y los
// tests comprueban que ninguna se sale del lienzo ni pisa a otra.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Slot =
  | 'logo'
  | 'avatar'
  | 'kicker'
  | 'name'
  | 'subtitle'
  | 'headline'
  | 'services'
  | 'steps'
  | 'meta'
  | 'qr'
  | 'cta'
  | 'site'
  | 'brand';

export interface CellLayout {
  width: number;
  height: number;
  boxes: Partial<Record<Slot, Box>>;
}

export interface MaterialLayout {
  width: number;
  height: number;
  /** El diseño (en una hoja de copias, el de cada copia). */
  cell: CellLayout;
  /** Hoja de copias (tarjetas, pegatinas): esquina de cada copia y largo de las marcas de corte. */
  sheet?: { positions: Array<{ x: number; y: number }>; cropMark: number };
  /** Cartel con pestañas: las pestañas para arrancar, debajo del diseño. */
  tabs?: { top: number; items: Array<{ area: Box; qr: Box; text: Box }> };
}

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });

export const inset = (b: Box, dx: number, dy = dx): Box => box(b.x + dx, b.y + dy, b.w - 2 * dx, b.h - 2 * dy);

/** Reparte el alto de `b` en filas proporcionales a `weights`, con `gap` entre ellas. */
export function rows(b: Box, weights: number[], gap = 0): Box[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const available = b.h - gap * (weights.length - 1);
  let y = b.y;
  return weights.map((w) => {
    const h = (available * w) / total;
    const row = box(b.x, y, b.w, h);
    y += h + gap;
    return row;
  });
}

/** Reparte el ancho de `b` en columnas proporcionales a `weights`, con `gap` entre ellas. */
export function cols(b: Box, weights: number[], gap = 0): Box[] {
  const total = weights.reduce((sum, w) => sum + w, 0);
  const available = b.w - gap * (weights.length - 1);
  let x = b.x;
  return weights.map((w) => {
    const width = (available * w) / total;
    const col = box(x, b.y, width, b.h);
    x += width + gap;
    return col;
  });
}

/** El cuadrado más grande dentro de `b`, centrado o pegado a un lado. */
export function squareIn(b: Box, align: 'start' | 'center' | 'end' = 'center'): Box {
  const side = Math.min(b.w, b.h);
  const x = align === 'start' ? b.x : align === 'end' ? b.x + b.w - side : b.x + (b.w - side) / 2;
  return box(x, b.y + (b.h - side) / 2, side, side);
}

type Boxes = Partial<Record<Slot, Box>>;

// ── Redes sociales ───────────────────────────────────────────────────────────────────────────
function socialLayout(W: number, H: number): Boxes {
  const ratio = W / H;
  const full = box(0, 0, W, H);

  if (ratio > 1.4) {
    // Horizontal (1200×630): a la izquierda quién es y qué hace; a la derecha el QR.
    const area = inset(full, H * 0.08);
    const [left, right] = cols(area, [63, 37], W * 0.03);
    const [logo, header, headline, services, meta] = rows(left, [12, 26, 21, 29, 12], H * 0.02);
    const [avatarCol, textCol] = cols(header, [24, 76], W * 0.015);
    const [name, subtitle] = rows(textCol, [58, 42]);
    const [qrRow, cta, site] = rows(right, [72, 16, 12], H * 0.015);
    return { logo, avatar: squareIn(avatarCol, 'start'), name, subtitle, headline, services, meta, qr: squareIn(qrRow), cta, site };
  }

  if (ratio > 0.95) {
    // Cuadrada (1080×1080).
    const area = inset(full, W * 0.065);
    const [logo, header, headline, services, meta, qrRow] = rows(area, [8, 19, 15, 25, 7, 26], H * 0.012);
    const [avatarCol, textCol] = cols(header, [24, 76], W * 0.025);
    const [name, subtitle] = rows(textCol, [58, 42]);
    const [ctaCol, qrCol] = cols(qrRow, [62, 38], W * 0.03);
    const [cta, site] = rows(ctaCol, [62, 38], H * 0.008);
    return { logo, avatar: squareIn(avatarCol, 'start'), name, subtitle, headline, services, meta, qr: squareIn(qrCol, 'end'), cta, site };
  }

  // Vertical (1080×1350) e historia (1080×1920): todo en columna, centrado.
  const tall = ratio < 0.7;
  const area = inset(full, W * 0.07, H * (tall ? 0.06 : 0.05));
  const weights = tall ? [5, 17, 6, 3.5, 13, 25, 4.5, 21] : [6, 18, 7, 4, 13.5, 22, 5, 22];
  const [logo, avatarRow, name, subtitle, headline, services, meta, qrRow] = rows(area, weights, H * 0.012);
  const [ctaCol, qrCol] = cols(qrRow, [60, 40], W * 0.04);
  const [cta, site] = rows(ctaCol, [62, 38], H * 0.008);
  return { logo, avatar: squareIn(avatarRow), name, subtitle, headline, services, meta, qr: squareIn(qrCol, 'end'), cta, site };
}

// ── Flyer para buzonear (A5 y DL) ────────────────────────────────────────────────────────────
function mailboxLayout(W: number, H: number): Boxes {
  const brandH = H * 0.035;
  const brand = box(0, H - brandH, W, brandH);
  const area = inset(box(0, 0, W, H - brandH), W * 0.07, H * 0.035);
  const [logo, headline, header, services, steps, meta, qrRow] = rows(area, [5, 11, 11, 21, 19, 5, 21], H * 0.011);
  const [avatarCol, textCol] = cols(header, [W / H < 0.6 ? 30 : 24, 70], W * 0.03);
  const [name, subtitle] = rows(textCol, [56, 44]);
  const [ctaCol, qrCol] = cols(qrRow, [56, 44], W * 0.04);
  const [cta, site] = rows(ctaCol, [62, 38], H * 0.006);
  return { logo, headline, avatar: squareIn(avatarCol, 'start'), name, subtitle, services, steps, meta, qr: squareIn(qrCol, 'end'), cta, site, brand };
}

// ── Tarjetas (85×55 mm) ──────────────────────────────────────────────────────────────────────
function businessCardLayout(W: number, H: number): Boxes {
  const area = inset(box(0, 0, W, H), H * 0.09);
  const [left, right] = cols(area, [63, 37], W * 0.035);
  const [logo, name, subtitle, services, site] = rows(left, [17, 22, 13, 30, 18], H * 0.025);
  const [qrRow, cta] = rows(right, [80, 20], H * 0.02);
  return { logo, name, subtitle, services, site, qr: squareIn(qrRow), cta };
}

function nextVisitCardLayout(W: number, H: number): Boxes {
  const area = inset(box(0, 0, W, H), H * 0.09);
  const [left, right] = cols(area, [63, 37], W * 0.035);
  const [logo, headline, name, subtitle, site] = rows(left, [16, 30, 15, 23, 16], H * 0.02);
  const [qrRow, cta] = rows(right, [80, 20], H * 0.02);
  return { logo, headline, name, subtitle, site, qr: squareIn(qrRow), cta };
}

// ── Pegatina (5×5 cm) ────────────────────────────────────────────────────────────────────────
function stickerLayout(W: number, H: number): Boxes {
  const area = inset(box(0, 0, W, H), W * 0.08);
  const [kicker, qrRow, name, site] = rows(area, [15, 62, 12, 11], H * 0.015);
  return { kicker, qr: squareIn(qrRow), name, site };
}

// ── Vinilo para la furgoneta ─────────────────────────────────────────────────────────────────
function vanLayout(W: number, H: number, sizeId: string): Boxes {
  const area = inset(box(0, 0, W, H), H * 0.08);
  if (sizeId === 'rear') {
    const [left, right] = cols(area, [58, 42], W * 0.03);
    const [logo, name, subtitle, site] = rows(left, [20, 32, 14, 18], H * 0.035);
    const [qrRow, cta] = rows(right, [82, 18], H * 0.02);
    return { logo, name, subtitle, site, qr: squareIn(qrRow), cta };
  }
  const [left, right] = cols(area, [64, 36], W * 0.03);
  const [logo, name, subtitle, services, site] = rows(left, [16, 26, 11, 25, 14], H * 0.025);
  const [qrRow, cta] = rows(right, [82, 18], H * 0.02);
  return { logo, name, subtitle, services, site, qr: squareIn(qrRow), cta };
}

// ── Cartel con pestañas (A4) ─────────────────────────────────────────────────────────────────
export const TEAR_OFF_TABS = 8;
const TEAR_OFF_TOP = 0.74;

function tearOffMainLayout(W: number, H: number): Boxes {
  const main = box(0, 0, W, H * TEAR_OFF_TOP);
  const area = inset(main, W * 0.07, H * 0.035);
  const [logo, headline, header, services, qrRow, meta] = rows(area, [6, 14, 15, 22, 34, 6], H * 0.01);
  const [avatarCol, textCol] = cols(header, [22, 78], W * 0.03);
  const [name, subtitle] = rows(textCol, [56, 44]);
  const [ctaCol, qrCol] = cols(qrRow, [55, 45], W * 0.04);
  const [cta, site] = rows(ctaCol, [62, 38], H * 0.006);
  return { logo, headline, avatar: squareIn(avatarCol, 'start'), name, subtitle, services, qr: squareIn(qrCol, 'end'), cta, site, meta };
}

function tearOffTabs(W: number, H: number): MaterialLayout['tabs'] {
  const top = H * TEAR_OFF_TOP;
  const tabW = W / TEAR_OFF_TABS;
  const items = Array.from({ length: TEAR_OFF_TABS }, (_, i) => {
    const area = box(i * tabW, top, tabW, H - top);
    const inner = inset(area, tabW * 0.1, tabW * 0.12);
    const qr = box(inner.x, inner.y, inner.w, inner.w);
    const text = box(inner.x, qr.y + qr.h + tabW * 0.08, inner.w, inner.y + inner.h - (qr.y + qr.h + tabW * 0.08));
    return { area, qr, text };
  });
  return { top, items };
}

// ── Cartel para la valla (A3) ────────────────────────────────────────────────────────────────
function fenceLayout(W: number, H: number): Boxes {
  const brandH = H * 0.03;
  const brand = box(0, H - brandH, W, brandH);
  const area = inset(box(0, 0, W, H - brandH), W * 0.07, H * 0.035);
  const [logo, kicker, name, subtitle, services, qrRow, cta, site] = rows(area, [7, 5, 11, 4.5, 11, 40, 5.5, 4], H * 0.01);
  return { logo, kicker, name, subtitle, services, qr: squareIn(qrRow), cta, site, brand };
}

// ── Tu QR ────────────────────────────────────────────────────────────────────────────────────
function qrCodeLayout(W: number, H: number): Boxes {
  const area = inset(box(0, 0, W, H), W * 0.07);
  const [logo, qrRow, name, site] = rows(area, [9, 69, 11, 8], H * 0.015);
  return { logo, qr: squareIn(qrRow), name, site };
}

// ── Hojas de copias ──────────────────────────────────────────────────────────────────────────
function sheetPositions(W: number, H: number, cellW: number, cellH: number, colsN: number, rowsN: number, gap: number) {
  const gridW = colsN * cellW + (colsN - 1) * gap;
  const gridH = rowsN * cellH + (rowsN - 1) * gap;
  const x0 = Math.round((W - gridW) / 2);
  const y0 = Math.round((H - gridH) / 2);
  const positions: Array<{ x: number; y: number }> = [];
  for (let r = 0; r < rowsN; r += 1) {
    for (let c = 0; c < colsN; c += 1) positions.push({ x: x0 + c * (cellW + gap), y: y0 + r * (cellH + gap) });
  }
  return positions;
}

/** La resolución de una hoja A4 a partir de su ancho en píxeles. */
const sheetDpi = (W: number) => Math.round(((W / PRINT.a4.w) * 25.4) * 10) / 10;

export function layoutFor(material: MaterialId, sizeId: string, W: number, H: number): MaterialLayout {
  const cell = (width: number, height: number, boxes: Boxes): CellLayout => ({ width, height, boxes });

  switch (material) {
    case 'social':
      return { width: W, height: H, cell: cell(W, H, socialLayout(W, H)) };
    case 'mailbox_flyer':
      return { width: W, height: H, cell: cell(W, H, mailboxLayout(W, H)) };
    case 'van_vinyl':
      return { width: W, height: H, cell: cell(W, H, vanLayout(W, H, sizeId)) };
    case 'fence_sign':
      return { width: W, height: H, cell: cell(W, H, fenceLayout(W, H)) };
    case 'qr_code':
      return { width: W, height: H, cell: cell(W, H, qrCodeLayout(W, H)) };
    case 'tear_off_poster':
      return { width: W, height: H, cell: cell(W, H, tearOffMainLayout(W, H)), tabs: tearOffTabs(W, H) };
    case 'business_card':
    case 'next_visit_card': {
      const design = material === 'business_card' ? businessCardLayout : nextVisitCardLayout;
      if (sizeId !== 'sheet') return { width: W, height: H, cell: cell(W, H, design(W, H)) };
      // Hoja A4 con 10 tarjetas de 85×55 mm, pegadas (un solo corte entre ellas).
      const dpi = sheetDpi(W);
      const cw = mmToPx(PRINT.card.w, dpi);
      const ch = mmToPx(PRINT.card.h, dpi);
      return {
        width: W,
        height: H,
        cell: cell(cw, ch, design(cw, ch)),
        sheet: { positions: sheetPositions(W, H, cw, ch, 2, 5, 0), cropMark: mmToPx(5, dpi) },
      };
    }
    case 'qr_stickers': {
      // Hoja A4 con 15 pegatinas de 5×5 cm, separadas 5 mm para cortar con margen.
      const dpi = sheetDpi(W);
      const side = mmToPx(PRINT.sticker.w, dpi);
      return {
        width: W,
        height: H,
        cell: cell(side, side, stickerLayout(side, side)),
        sheet: { positions: sheetPositions(W, H, side, side, 3, 5, mmToPx(5, dpi)), cropMark: mmToPx(3, dpi) },
      };
    }
    default:
      throw new Error(`Sin diseño para ${material as string}`);
  }
}

/** Todas las cajas que se pintan, para los tests: la del diseño y las de las pestañas. */
export function leafBoxes(layout: MaterialLayout): Array<{ name: string; box: Box }> {
  const out = Object.entries(layout.cell.boxes).map(([name, b]) => ({ name, box: b as Box }));
  layout.tabs?.items.forEach((tab, i) => {
    out.push({ name: `tab${i}.qr`, box: tab.qr }, { name: `tab${i}.text`, box: tab.text });
  });
  return out;
}
