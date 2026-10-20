import QRCode from 'qrcode';
import { GARSER_LOGO_PATHS, GARSER_LOGO_VIEWBOX } from './garserLogo';
import { inset, layoutFor, type Box, type CellLayout, type Slot } from './layouts';
import type { MaterialId, MaterialSize } from './materials';
import type { MarketingContent, MarketingTheme } from './content';
import { clampLines, wrapText } from './text';

// Marketing del profesional: pinta un material en un canvas, a tamaño real o a escala (vista
// previa). Solo pinta dentro de las cajas de layouts.ts. La marca de GarSer (logo, «garser.es» y,
// en lo impreso, la franja final) va siempre y no se puede quitar.

export interface RenderInput {
  material: MaterialId;
  size: MaterialSize;
  content: MarketingContent;
  /** La foto ya cargada (con CORS); sin ella, las iniciales. */
  avatar: HTMLImageElement | null;
  /** 1 = tamaño real. Menos, para la vista previa (mismo diseño, menos píxeles). */
  scale?: number;
}

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const QR_INK = '#171C2B';

interface Palette {
  bg: string;
  panel: string;
  text: string;
  muted: string;
  accent: string;
  chipBg: string;
  chipText: string;
  badgeBg: string;
  badgeText: string;
  deco: string;
  brandBg: string;
  brandText: string;
  logo: 'color' | 'negative';
}

const PALETTES: Record<MarketingTheme, Palette> = {
  green: {
    bg: '#0E3A22',
    panel: '#134D2D',
    text: '#FFFFFF',
    muted: 'rgba(255,255,255,0.82)',
    accent: '#2BCA21',
    chipBg: 'rgba(255,255,255,0.12)',
    chipText: '#FFFFFF',
    badgeBg: '#FFFFFF',
    badgeText: '#14532D',
    deco: 'rgba(43,202,33,0.12)',
    brandBg: '#0A2A18',
    brandText: 'rgba(255,255,255,0.9)',
    logo: 'negative',
  },
  light: {
    bg: '#FFFFFF',
    panel: '#F1F8F2',
    text: '#171C2B',
    muted: '#4B5563',
    accent: '#24A54C',
    chipBg: '#E8F5EA',
    chipText: '#14532D',
    badgeBg: '#24A54C',
    badgeText: '#FFFFFF',
    deco: 'rgba(36,165,76,0.09)',
    brandBg: '#171C2B',
    brandText: '#FFFFFF',
    logo: 'color',
  },
};

type Ctx = CanvasRenderingContext2D;

const fontOf = (weight: number, size: number) => `${weight} ${Math.max(1, Math.round(size))}px ${FONT}`;

interface TextStyle {
  weight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Tamaño máximo, en proporción al alto de la caja. */
  maxLines?: number;
  lineHeight?: number;
  valign?: 'top' | 'middle' | 'bottom';
  /** Tope del tamaño de letra, en px. */
  maxSize?: number;
}

/** Escribe `text` en la caja con la letra más grande que cabe (y como mucho `maxLines` líneas). */
function fitText(ctx: Ctx, text: string, b: Box, style: TextStyle) {
  if (!text || b.w <= 0 || b.h <= 0) return;
  const lineHeight = style.lineHeight ?? 1.18;
  const maxLines = style.maxLines ?? 2;
  let size = Math.min(style.maxSize ?? Infinity, b.h / lineHeight);
  const minSize = Math.max(4, size * 0.25);
  const measure = (value: string) => ctx.measureText(value).width;
  let lines: string[] = [];
  for (;;) {
    ctx.font = fontOf(style.weight, size);
    lines = wrapText(text, b.w, measure);
    const fits = lines.length <= maxLines && lines.length * size * lineHeight <= b.h && lines.every((l) => measure(l) <= b.w);
    if (fits || size <= minSize) break;
    size *= 0.93;
  }
  lines = clampLines(lines, maxLines, b.w, measure);
  const lh = size * lineHeight;
  const total = lines.length * lh;
  const valign = style.valign ?? 'middle';
  const top = valign === 'top' ? b.y : valign === 'bottom' ? b.y + b.h - total : b.y + (b.h - total) / 2;
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'middle';
  ctx.textAlign = style.align;
  const x = style.align === 'left' ? b.x : style.align === 'right' ? b.x + b.w : b.x + b.w / 2;
  lines.forEach((line, i) => ctx.fillText(line, x, top + lh * (i + 0.5)));
}

function roundRect(ctx: Ctx, b: Box, radius: number) {
  const r = Math.min(radius, b.w / 2, b.h / 2);
  ctx.beginPath();
  ctx.moveTo(b.x + r, b.y);
  ctx.arcTo(b.x + b.w, b.y, b.x + b.w, b.y + b.h, r);
  ctx.arcTo(b.x + b.w, b.y + b.h, b.x, b.y + b.h, r);
  ctx.arcTo(b.x, b.y + b.h, b.x, b.y, r);
  ctx.arcTo(b.x, b.y, b.x + b.w, b.y, r);
  ctx.closePath();
}

let logoPaths: Array<{ part: string; fill: string; path: Path2D }> | null = null;

/** El logo vectorial, tan grande como quepa en la caja. */
function drawLogo(ctx: Ctx, b: Box, variant: Palette['logo'], align: 'left' | 'center') {
  if (!logoPaths) logoPaths = GARSER_LOGO_PATHS.map((p) => ({ part: p.part, fill: p.fill, path: new Path2D(p.d) }));
  const scale = Math.min(b.w / GARSER_LOGO_VIEWBOX.width, b.h / GARSER_LOGO_VIEWBOX.height);
  const w = GARSER_LOGO_VIEWBOX.width * scale;
  const h = GARSER_LOGO_VIEWBOX.height * scale;
  ctx.save();
  ctx.translate(align === 'left' ? b.x : b.x + (b.w - w) / 2, b.y + (b.h - h) / 2);
  ctx.scale(scale, scale);
  logoPaths.forEach((p) => {
    ctx.fillStyle = variant === 'negative' && p.part === 'wordmark' ? '#FFFFFF' : p.fill;
    ctx.fill(p.path);
  });
  ctx.restore();
}

function drawAvatar(ctx: Ctx, b: Box, avatar: HTMLImageElement | null, initials: string, palette: Palette) {
  const r = Math.min(b.w, b.h) / 2;
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = palette.accent;
  ctx.fill();
  const inner = r * 0.93;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.clip();
  if (avatar && avatar.naturalWidth > 0) {
    const d = inner * 2;
    const s = Math.max(d / avatar.naturalWidth, d / avatar.naturalHeight);
    const w = avatar.naturalWidth * s;
    const h = avatar.naturalHeight * s;
    ctx.drawImage(avatar, cx - w / 2, cy - h / 2, w, h);
  } else {
    ctx.fillStyle = palette === PALETTES.green ? '#1C6B3D' : '#14532D';
    ctx.fillRect(cx - inner, cy - inner, inner * 2, inner * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = fontOf(800, inner * 0.82);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initials, cx, cy + inner * 0.04);
  }
  ctx.restore();
}

/** El QR sobre una placa blanca (se lee igual en fondo claro u oscuro), nítido: sin suavizado. */
async function drawQr(ctx: Ctx, b: Box, url: string, palette: Palette) {
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, b, b.w * 0.06);
  ctx.fill();
  if (palette.logo === 'color') {
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = Math.max(1, b.w * 0.006);
    ctx.stroke();
  }
  const inner = inset(b, b.w * 0.07);
  const qr = document.createElement('canvas');
  await QRCode.toCanvas(qr, url, {
    margin: 0,
    width: Math.max(64, Math.round(inner.w)),
    errorCorrectionLevel: 'M',
    color: { dark: QR_INK, light: '#FFFFFF' },
  });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, inner.x, inner.y, inner.w, inner.h);
  ctx.imageSmoothingEnabled = true;
}

/** Servicios como «chips» centrados (redes) o en lista con marca verde (impresos). */
function drawServices(ctx: Ctx, b: Box, services: string[], palette: Palette, mode: 'chips' | 'list' | 'line', align: 'left' | 'center') {
  if (services.length === 0) return;
  if (mode === 'line') {
    fitText(ctx, services.join(' · '), b, { weight: 600, color: palette.muted, align, maxLines: 2 });
    return;
  }
  if (mode === 'chips') {
    // El tamaño más grande con el que todos los chips caben en la caja, en líneas centradas (con
    // tope: con un solo servicio no sale un chip gigante).
    let size = Math.min(b.h / 3, b.w * 0.05);
    for (;;) {
      ctx.font = fontOf(700, size);
      const padX = size * 0.75;
      const chipH = size * 1.9;
      const gap = size * 0.45;
      const lines: Array<Array<{ text: string; w: number }>> = [[]];
      let lineW = 0;
      for (const text of services) {
        const w = ctx.measureText(text).width + padX * 2;
        if (lineW > 0 && lineW + gap + w > b.w) {
          lines.push([]);
          lineW = 0;
        }
        lines[lines.length - 1].push({ text, w });
        lineW += (lineW > 0 ? gap : 0) + w;
      }
      const totalH = lines.length * chipH + (lines.length - 1) * gap;
      const widest = Math.max(...lines.flat().map((c) => c.w));
      if ((totalH <= b.h && widest <= b.w) || size < 6) {
        let y = b.y + (b.h - totalH) / 2;
        for (const line of lines) {
          const lw = line.reduce((sum, c) => sum + c.w, 0) + gap * (line.length - 1);
          let x = align === 'center' ? b.x + (b.w - lw) / 2 : b.x;
          for (const chip of line) {
            ctx.fillStyle = palette.chipBg;
            roundRect(ctx, { x, y, w: chip.w, h: chipH }, chipH / 2);
            ctx.fill();
            ctx.fillStyle = palette.chipText;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(chip.text, x + chip.w / 2, y + chipH / 2);
            x += chip.w + gap;
          }
          y += chipH + gap;
        }
        return;
      }
      size *= 0.93;
    }
  }
  // Lista con una marca verde delante de cada servicio, en una o dos columnas: la que deje la letra
  // más grande (en un hueco estrecho, una; en uno ancho y bajo, dos).
  const colGap = b.w * 0.04;
  const sizeFor = (columns: number) => {
    const perColumn = Math.ceil(services.length / columns);
    const columnW = (b.w - colGap * (columns - 1)) / columns;
    let s = Math.min((b.h / perColumn) * 0.62, b.h * 0.3);
    ctx.font = fontOf(600, s);
    const widestText = Math.max(...services.map((item) => ctx.measureText(item).width));
    const room = columnW - s * 1.6;
    if (widestText > room) s *= room / widestText;
    return s;
  };
  const twoCols = services.length > 1 && sizeFor(2) > sizeFor(1) * 1.05;
  const perCol = twoCols ? Math.ceil(services.length / 2) : services.length;
  const colW = twoCols ? (b.w - colGap) / 2 : b.w;
  const rowH = b.h / perCol;
  const size = sizeFor(twoCols ? 2 : 1);
  ctx.font = fontOf(600, size);
  services.forEach((service, i) => {
    const col = twoCols ? Math.floor(i / perCol) : 0;
    const row = twoCols ? i % perCol : i;
    const x = b.x + col * (colW + b.w * 0.04);
    const cy = b.y + rowH * (row + 0.5);
    const r = size * 0.42;
    ctx.beginPath();
    ctx.arc(x + r, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();
    // La marca (✓) dibujada, no como carácter: se ve igual en todos los móviles.
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(1, r * 0.32);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + r * 0.55, cy + r * 0.02);
    ctx.lineTo(x + r * 0.9, cy + r * 0.38);
    ctx.lineTo(x + r * 1.48, cy - r * 0.36);
    ctx.stroke();
    ctx.fillStyle = palette.text;
    ctx.font = fontOf(600, size);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(service, x + size * 1.35, cy);
  });
}

/** Valoración, sello «Sin gastos de gestión» o, si no hay ninguno, cómo se paga. */
function drawMeta(ctx: Ctx, b: Box, content: MarketingContent, palette: Palette, align: 'left' | 'center') {
  const size = b.h * 0.5;
  ctx.font = fontOf(700, size);
  const items: Array<{ kind: 'text' | 'badge'; text: string; w: number }> = [];
  if (content.rating) items.push({ kind: 'text', text: content.rating.label, w: ctx.measureText(content.rating.label).width });
  if (content.badge) items.push({ kind: 'badge', text: content.badge, w: ctx.measureText(content.badge).width + size * 1.4 });
  if (items.length === 0) {
    fitText(ctx, content.paymentNote, b, { weight: 600, color: palette.muted, align, maxLines: 1 });
    return;
  }
  const gap = size * 0.9;
  const total = items.reduce((sum, i) => sum + i.w, 0) + gap * (items.length - 1);
  const factor = total > b.w ? b.w / total : 1;
  const s = size * factor;
  ctx.font = fontOf(700, s);
  let x = align === 'center' ? b.x + (b.w - total * factor) / 2 : b.x;
  const cy = b.y + b.h / 2;
  for (const item of items) {
    const w = item.w * factor;
    if (item.kind === 'badge') {
      const h = s * 1.75;
      ctx.fillStyle = palette.badgeBg;
      roundRect(ctx, { x, y: cy - h / 2, w, h }, h / 2);
      ctx.fill();
      ctx.fillStyle = palette.badgeText;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, x + w / 2, cy);
    } else {
      ctx.fillStyle = palette.text;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, x, cy);
    }
    x += w + gap * factor;
  }
}

function drawSteps(ctx: Ctx, b: Box, content: MarketingContent, palette: Palette) {
  const titleH = b.h * 0.2;
  fitText(ctx, 'Cómo funciona', { x: b.x, y: b.y, w: b.w, h: titleH }, { weight: 800, color: palette.accent, align: 'left', maxLines: 1 });
  const steps = ['Escanea el código QR', 'Elige el día y la hora', content.paymentNote];
  const rowH = (b.h - titleH) / steps.length;
  steps.forEach((step, i) => {
    const y = b.y + titleH + rowH * i;
    const r = Math.min(rowH * 0.32, b.w * 0.05);
    const cx = b.x + r;
    const cy = y + rowH / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = palette.accent;
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = fontOf(800, r * 1.15);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(i + 1), cx, cy + r * 0.05);
    fitText(ctx, step, { x: b.x + r * 2.8, y: y + rowH * 0.15, w: b.w - r * 2.8, h: rowH * 0.7 }, { weight: 600, color: palette.text, align: 'left', maxLines: 1 });
  });
}

/** La franja final de los impresos: la marca de GarSer, que no se puede quitar. */
function drawBrandStrip(ctx: Ctx, b: Box, palette: Palette) {
  ctx.fillStyle = palette.brandBg;
  ctx.fillRect(b.x, b.y, b.w, b.h);
  fitText(ctx, 'Hecho con GarSer · Reserva en garser.es', inset(b, b.w * 0.05, b.h * 0.22), { weight: 600, color: palette.brandText, align: 'center', maxLines: 1 });
}

function drawDecoration(ctx: Ctx, W: number, H: number, palette: Palette) {
  const r = Math.max(W, H) * 0.32;
  ctx.fillStyle = palette.deco;
  ctx.beginPath();
  ctx.arc(W * 1.02, -H * 0.02, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-W * 0.08, H * 1.04, r * 0.8, 0, Math.PI * 2);
  ctx.fill();
}

/** Qué texto va en cada hueco, según el material. */
function slotTexts(material: MaterialId, content: MarketingContent): Partial<Record<Slot, string>> {
  const base: Partial<Record<Slot, string>> = {
    name: content.name,
    subtitle: content.subtitle,
    headline: content.headline,
    cta: content.cta,
    site: `Reserva en ${content.site}`,
  };
  switch (material) {
    case 'social':
      return { ...base, site: content.site };
    case 'business_card':
      return { ...base, cta: 'Escanea y reserva' };
    case 'next_visit_card':
      return {
        ...base,
        headline: 'Reserva tu próxima visita',
        name: `con ${content.name}`,
        subtitle: content.badge ? 'Escanea y elige día y hora. Sin gastos de gestión.' : 'Escanea y elige el día y la hora.',
        cta: 'Escanea aquí',
      };
    case 'van_vinyl':
      return { ...base, cta: 'Escanea y reserva' };
    case 'qr_stickers':
      return { kicker: 'Reserva tu próxima visita', name: content.name, site: content.site };
    case 'fence_sign':
      return { ...base, kicker: 'Este jardín lo cuida', cta: 'Escanea y reserva en un minuto', site: content.site };
    case 'qr_code':
      return { name: content.name, site: `Reserva en ${content.site}` };
    default:
      return base;
  }
}

/** Pinta un diseño (o una copia de una hoja) en (0,0) del contexto. */
async function drawCell(ctx: Ctx, material: MaterialId, cell: CellLayout, content: MarketingContent, avatar: HTMLImageElement | null, palette: Palette) {
  const W = cell.width;
  const H = cell.height;
  const b = cell.boxes;
  ctx.fillStyle = palette.bg;
  ctx.fillRect(0, 0, W, H);
  if (material === 'social' || material === 'mailbox_flyer' || material === 'fence_sign' || material === 'van_vinyl' || material === 'tear_off_poster') {
    drawDecoration(ctx, W, H, palette);
  }

  const ratio = W / H;
  const centered = (material === 'social' && ratio < 0.95) || material === 'fence_sign' || material === 'qr_code' || material === 'qr_stickers';
  const align: 'left' | 'center' = centered ? 'center' : 'left';
  const texts = slotTexts(material, content);

  if (b.logo) drawLogo(ctx, b.logo, palette.logo, centered ? 'center' : 'left');
  if (b.avatar) drawAvatar(ctx, b.avatar, avatar, content.initials, palette);
  if (b.kicker && texts.kicker) fitText(ctx, texts.kicker, b.kicker, { weight: 700, color: palette.accent, align, maxLines: 1 });
  if (b.name && texts.name) fitText(ctx, texts.name, b.name, { weight: 800, color: palette.text, align, maxLines: material === 'social' && centered ? 2 : 1 });
  if (b.subtitle && texts.subtitle) {
    fitText(ctx, texts.subtitle, b.subtitle, { weight: 500, color: palette.muted, align, maxLines: material === 'next_visit_card' ? 2 : 1 });
  }
  if (b.headline && texts.headline) {
    fitText(ctx, texts.headline, b.headline, { weight: 800, color: material === 'next_visit_card' ? palette.accent : palette.text, align, maxLines: 2, lineHeight: 1.12 });
  }
  if (b.services) {
    const mode = material === 'social' ? 'chips' : material === 'van_vinyl' || material === 'fence_sign' ? 'line' : 'list';
    // En una tarjeta de 85×55 mm, más de 4 servicios dejan la letra ilegible.
    const services = material === 'business_card' ? content.services.slice(0, 4) : content.services;
    drawServices(ctx, b.services, services, palette, mode, align);
  }
  if (b.steps) drawSteps(ctx, b.steps, content, palette);
  if (b.meta) drawMeta(ctx, b.meta, content, palette, align);
  if (b.qr) await drawQr(ctx, b.qr, content.qrUrl, palette);
  // Junto al QR (a su izquierda) el texto va alineado a la izquierda y pegado a él; debajo, centrado.
  const besideQr = Boolean(b.cta && b.qr && b.cta.x + b.cta.w <= b.qr.x + 1);
  if (b.cta && texts.cta) {
    fitText(ctx, texts.cta, b.cta, { weight: 700, color: palette.text, align: besideQr ? 'left' : 'center', maxLines: 2, valign: besideQr ? 'bottom' : 'middle' });
  }
  if (b.site && texts.site) {
    fitText(ctx, texts.site, b.site, { weight: 800, color: palette.accent, align: besideQr ? 'left' : align, maxLines: 1, valign: besideQr ? 'top' : 'middle' });
  }
  if (b.brand) drawBrandStrip(ctx, b.brand, palette);
}

function drawCropMarks(ctx: Ctx, positions: Array<{ x: number; y: number }>, cellW: number, cellH: number, mark: number, W: number) {
  const xs = [...new Set(positions.flatMap((p) => [p.x, p.x + cellW]))];
  const ys = [...new Set(positions.flatMap((p) => [p.y, p.y + cellH]))];
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const gap = mark * 0.4;
  ctx.strokeStyle = '#9CA3AF';
  ctx.lineWidth = Math.max(1, W / 2480);
  ctx.beginPath();
  xs.forEach((x) => {
    ctx.moveTo(x, top - gap - mark);
    ctx.lineTo(x, top - gap);
    ctx.moveTo(x, bottom + gap);
    ctx.lineTo(x, bottom + gap + mark);
  });
  ys.forEach((y) => {
    ctx.moveTo(left - gap - mark, y);
    ctx.lineTo(left - gap, y);
    ctx.moveTo(right + gap, y);
    ctx.lineTo(right + gap + mark, y);
  });
  ctx.stroke();
}

async function drawTabs(ctx: Ctx, layout: ReturnType<typeof layoutFor>, content: MarketingContent, palette: Palette) {
  if (!layout.tabs) return;
  const { top, items } = layout.tabs;
  const W = layout.width;
  ctx.fillStyle = palette.panel;
  ctx.fillRect(0, top, W, layout.height - top);
  // Líneas de corte: arriba, de lado a lado, y entre pestañas.
  ctx.save();
  ctx.strokeStyle = palette.muted;
  ctx.lineWidth = Math.max(1, W / 1240);
  ctx.setLineDash([W / 120, W / 160]);
  ctx.beginPath();
  ctx.moveTo(0, top);
  ctx.lineTo(W, top);
  items.slice(1).forEach((tab) => {
    ctx.moveTo(tab.area.x, top);
    ctx.lineTo(tab.area.x, layout.height);
  });
  ctx.stroke();
  ctx.restore();
  const label = `${content.name} · ${content.site}`;
  for (const tab of items) {
    await drawQr(ctx, tab.qr, content.qrUrl, palette);
    // Texto en vertical (de abajo arriba), como en las pestañas de toda la vida.
    ctx.save();
    ctx.translate(tab.text.x + tab.text.w / 2, tab.text.y + tab.text.h / 2);
    ctx.rotate(-Math.PI / 2);
    fitText(ctx, label, { x: -tab.text.h / 2, y: -tab.text.w / 2, w: tab.text.h, h: tab.text.w }, { weight: 700, color: palette.text, align: 'center', maxLines: 2 });
    ctx.restore();
  }
}

export async function renderMaterial(canvas: HTMLCanvasElement, input: RenderInput): Promise<void> {
  const scale = input.scale ?? 1;
  const W = Math.max(1, Math.round(input.size.width * scale));
  const H = Math.max(1, Math.round(input.size.height * scale));
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no puede dibujar el material.');
  const palette = PALETTES[input.content.theme];
  const layout = layoutFor(input.material, input.size.id, W, H);

  if (layout.sheet) {
    // Hoja de copias: se pinta una y se repite, con las marcas de corte alrededor.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    const one = document.createElement('canvas');
    one.width = Math.round(layout.cell.width);
    one.height = Math.round(layout.cell.height);
    const oneCtx = one.getContext('2d');
    if (!oneCtx) throw new Error('Este navegador no puede dibujar el material.');
    await drawCell(oneCtx, input.material, layout.cell, input.content, input.avatar, palette);
    layout.sheet.positions.forEach((p) => ctx.drawImage(one, p.x, p.y));
    drawCropMarks(ctx, layout.sheet.positions, one.width, one.height, layout.sheet.cropMark, W);
    one.width = 0;
    one.height = 0;
    return;
  }

  await drawCell(ctx, input.material, layout.cell, input.content, input.avatar, palette);
  await drawTabs(ctx, layout, input.content, palette);
}

/** El material a tamaño real, en PNG. */
export async function renderToBlob(input: Omit<RenderInput, 'scale'>): Promise<Blob> {
  const canvas = document.createElement('canvas');
  await renderMaterial(canvas, { ...input, scale: 1 });
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  // Liberar la memoria del lienzo grande cuanto antes (en un iPhone cuenta).
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('No se ha podido crear la imagen.');
  return blob;
}

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();

/** Carga una foto con CORS (para poder descargar el canvas). Si falla, null: van las iniciales. */
export function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  const cached = imageCache.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
  imageCache.set(url, promise);
  return promise;
}
