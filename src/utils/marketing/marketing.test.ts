import { describe, expect, it } from 'vitest';
import { MARKETING_MATERIALS, MAX_CANVAS_PIXELS, mmToPx, safeDpi, getMaterial, PRINT_MATERIAL_IDS } from './materials';
import { layoutFor, leafBoxes, rows, cols, squareIn, type Box } from './layouts';
import {
  bookingUrl,
  buildMarketingContent,
  clientMessages,
  defaultOptions,
  defaultSubtitle,
  flyerCaption,
  initialsOf,
  materialFileName,
  ratingLabel,
  seasonalHeadline,
  whatsappUrl,
  type MarketingProfile,
} from './content';
import { clampLines, wrapText } from './text';

const EPS = 0.5;
const inside = (b: Box, W: number, H: number) => b.x >= -EPS && b.y >= -EPS && b.x + b.w <= W + EPS && b.y + b.h <= H + EPS && b.w > 0 && b.h > 0;
const overlap = (a: Box, b: Box) =>
  a.x + EPS < b.x + b.w && b.x + EPS < a.x + a.w && a.y + EPS < b.y + b.h && b.y + EPS < a.y + a.h;

const profile = (overrides: Partial<MarketingProfile> = {}): MarketingProfile => ({
  providerId: 'prov-123',
  name: 'Pablo Gómez',
  kind: 'solo',
  zone: 'Marbella',
  avatarUrl: null,
  ratingAverage: 4.8,
  ratingCount: 12,
  ...overrides,
});

describe('catálogo de materiales', () => {
  it('ningún tamaño pasa del límite de un canvas en un iPhone', () => {
    for (const material of MARKETING_MATERIALS) {
      for (const size of material.sizes) {
        expect(size.width * size.height, `${material.id}/${size.id}`).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      }
    }
  });

  it('los impresos van a 300 ppp salvo los grandes, que bajan solos', () => {
    expect(mmToPx(85, 300)).toBe(1004);
    expect(safeDpi(210, 297, 300)).toBe(300);
    expect(safeDpi(297, 420, 300)).toBeLessThan(300);
    expect(getMaterial('business_card').sizes.find((s) => s.id === 'card')).toMatchObject({ width: 1004, height: 650, dpi: 300 });
    expect(getMaterial('van_vinyl').sizes.find((s) => s.id === 'side')).toMatchObject({ width: 3937, height: 1969, dpi: 100 });
    expect(getMaterial('fence_sign').sizes[0].dpi).toBeGreaterThanOrEqual(280);
  });

  it('las redes tienen los cuatro tamaños estándar', () => {
    expect(getMaterial('social').sizes.map((s) => `${s.width}x${s.height}`)).toEqual(['1080x1350', '1080x1080', '1080x1920', '1200x630']);
  });

  it('todos los impresos dicen cómo imprimirse', () => {
    for (const id of PRINT_MATERIAL_IDS) expect(getMaterial(id).printNote, id).toBeTruthy();
  });
});

describe('diseños: nada se sale del lienzo ni se pisa', () => {
  for (const material of MARKETING_MATERIALS) {
    for (const size of material.sizes) {
      it(`${material.id} · ${size.id}`, () => {
        const layout = layoutFor(material.id, size.id, size.width, size.height);
        const cellW = layout.cell.width;
        const cellH = layout.cell.height;
        // Las cajas del diseño, dentro de su lienzo (en una hoja, dentro de cada copia).
        const boxes = leafBoxes(layout);
        expect(boxes.length).toBeGreaterThan(2);
        for (const { name, box } of boxes) {
          const isTab = name.startsWith('tab');
          expect(inside(box, isTab ? layout.width : cellW, isTab ? layout.height : cellH), `${name} fuera`).toBe(true);
        }
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            expect(overlap(boxes[i].box, boxes[j].box), `${boxes[i].name} pisa ${boxes[j].name}`).toBe(false);
          }
        }
        // Hojas: cada copia dentro de la hoja y sin pisar a otra.
        if (layout.sheet) {
          const cells = layout.sheet.positions.map((p) => ({ x: p.x, y: p.y, w: cellW, h: cellH }));
          cells.forEach((c) => expect(inside(c, layout.width, layout.height)).toBe(true));
          for (let i = 0; i < cells.length; i += 1) {
            for (let j = i + 1; j < cells.length; j += 1) expect(overlap(cells[i], cells[j])).toBe(false);
          }
        }
        // Siempre hay QR y marca de GarSer (logo o «garser.es»).
        expect(layout.cell.boxes.qr).toBeTruthy();
        expect(Boolean(layout.cell.boxes.logo || layout.cell.boxes.site)).toBe(true);
      });
    }
  }

  it('hoja de tarjetas: 10 de 85×55 mm; pegatinas: 15 de 5×5 cm', () => {
    const cards = layoutFor('business_card', 'sheet', 2480, 3508);
    expect(cards.sheet?.positions).toHaveLength(10);
    expect(cards.cell.width).toBe(1004);
    const stickers = layoutFor('qr_stickers', 'sheet', 2480, 3508);
    expect(stickers.sheet?.positions).toHaveLength(15);
    expect(stickers.cell.width).toBe(591);
  });

  it('cartel con pestañas: 8 pestañas con un QR de al menos 18 mm', () => {
    const layout = layoutFor('tear_off_poster', 'a4', 2480, 3508);
    expect(layout.tabs?.items).toHaveLength(8);
    const qrMm = (layout.tabs!.items[0].qr.w / 300) * 25.4;
    expect(qrMm).toBeGreaterThanOrEqual(18);
  });

  it('las ayudas reparten sin salirse', () => {
    const [a, b] = rows({ x: 0, y: 0, w: 100, h: 100 }, [1, 3], 10);
    expect(a).toEqual({ x: 0, y: 0, w: 100, h: 22.5 });
    expect(b.y + b.h).toBeCloseTo(100);
    const [c, d] = cols({ x: 0, y: 0, w: 100, h: 50 }, [1, 1]);
    expect(c.w + d.w).toBe(100);
    expect(squareIn({ x: 0, y: 0, w: 100, h: 40 }, 'end')).toEqual({ x: 60, y: 0, w: 40, h: 40 });
  });
});

describe('contenido', () => {
  const visible = ['Corte de césped', 'Poda de setos'];

  it('solo servicios que salen de verdad, como mucho 6, sin precios ni dirección', () => {
    const content = buildMarketingContent({
      profile: profile(),
      visibleServices: visible,
      feeWaiverEnabled: false,
      options: { ...defaultOptions(profile(), visible, new Date('2026-07-01')), services: ['Poda de setos', 'Poda de árboles', 'Corte de césped'] },
      source: 'social',
    });
    expect(content.services).toEqual(['Poda de setos', 'Corte de césped']);
    expect(JSON.stringify(content)).not.toMatch(/€|\d+ ?euros/);
    expect(content.subtitle).toBe('Jardinería en Marbella');
    expect(content.badge).toBeNull();
    expect(content.qrUrl).toBe('https://garser.es/reservar/prov-123?utm_source=social');
  });

  it('el sello «Sin gastos de gestión» solo con el interruptor encendido', () => {
    const options = defaultOptions(profile(), visible, new Date());
    expect(buildMarketingContent({ profile: profile(), visibleServices: visible, feeWaiverEnabled: true, options, source: 'x' }).badge).toBe('Sin gastos de gestión');
  });

  it('valoración solo si tiene reseñas y lo quiere enseñar', () => {
    const options = defaultOptions(profile(), visible, new Date());
    expect(buildMarketingContent({ profile: profile(), visibleServices: visible, feeWaiverEnabled: false, options, source: 'x' }).rating?.label).toBe('★ 4,8 · 12 reseñas');
    expect(buildMarketingContent({ profile: profile({ ratingCount: 0, ratingAverage: 0 }), visibleServices: visible, feeWaiverEnabled: false, options, source: 'x' }).rating).toBeNull();
    expect(buildMarketingContent({ profile: profile(), visibleServices: visible, feeWaiverEnabled: false, options: { ...options, showRating: false }, source: 'x' }).rating).toBeNull();
    expect(ratingLabel(5, 1)).toBe('★ 5,0 · 1 reseña');
  });

  it('titular y línea de zona recortados a su máximo; sin zona, texto genérico', () => {
    const content = buildMarketingContent({
      profile: profile({ zone: null }),
      visibleServices: visible,
      feeWaiverEnabled: false,
      options: { ...defaultOptions(profile({ zone: null }), visible, new Date()), headline: 'x'.repeat(80), subtitle: '' },
      source: 'x',
    });
    expect(content.headline).toHaveLength(42);
    expect(content.subtitle).toBe('Jardinería profesional');
    expect(defaultSubtitle({ zone: '  ' })).toBe('Jardinería profesional');
  });

  it('titular de temporada', () => {
    expect(seasonalHeadline(new Date('2026-04-10'))).toMatch(/primavera/);
    expect(seasonalHeadline(new Date('2026-07-10'))).toMatch(/verano/);
    expect(seasonalHeadline(new Date('2026-10-10'))).toMatch(/otoño/);
    expect(seasonalHeadline(new Date('2026-01-10'))).toMatch(/invierno/);
  });

  it('iniciales, enlace y nombre de archivo', () => {
    expect(initialsOf('Pablo Gómez')).toBe('PG');
    expect(initialsOf('Jardines')).toBe('JA');
    expect(bookingUrl('abc', 'vinilo furgo')).toBe('https://garser.es/reservar/abc?utm_source=vinilo%20furgo');
    expect(materialFileName('Jardines Pérez S.L.', 'van_vinyl', 'side')).toBe('garser-jardines-perez-s-l-vinilo-furgoneta-side.png');
  });

  it('pie de foto para redes', () => {
    const content = buildMarketingContent({ profile: profile(), visibleServices: visible, feeWaiverEnabled: true, options: defaultOptions(profile(), visible, new Date('2026-07-01')), source: 'social' });
    const caption = flyerCaption(content, 'Marbella', 'https://garser.es/reservar/prov-123');
    expect(caption).toContain('Tu jardín, listo para el verano');
    expect(caption).toContain('Corte de césped · Poda de setos.');
    expect(caption).toContain('sin gastos de gestión: https://garser.es/reservar/prov-123');
    expect(caption).toContain('#jardineria #Marbella #GarSer');
  });

  it('mensajes para clientes: autónomo en primera persona, empresa en plural, enlace al final', () => {
    const solo = clientMessages({ kind: 'solo', feeWaiverEnabled: false, link: 'L', date: new Date('2026-10-20') });
    expect(solo.map((m) => m.id)).toEqual(['online', 'season', 'thanks']);
    expect(solo[0].text).toContain('reservar conmigo');
    expect(solo[0].text).toContain('directamente a mí');
    expect(solo[1].text).toContain('poner tu jardín a punto este otoño');
    solo.forEach((m) => expect(m.text.endsWith('L')).toBe(true));
    const company = clientMessages({ kind: 'company', feeWaiverEnabled: true, link: 'L', date: new Date('2026-10-20') });
    expect(company[0].text).toContain('con nosotros');
    expect(company[0].text).toContain('sin gastos de gestión');
    expect(company[1].text).toContain('pasemos');
    expect(whatsappUrl('Hola & adiós')).toBe('https://wa.me/?text=Hola%20%26%20adi%C3%B3s');
  });
});

describe('cortes de línea', () => {
  const measure = (s: string) => s.length * 10;

  it('corta por palabras sin pasarse del ancho', () => {
    expect(wrapText('Tu jardín en buenas manos', 120, measure)).toEqual(['Tu jardín en', 'buenas manos']);
  });

  it('una palabra más larga que el ancho va sola', () => {
    expect(wrapText('Desbroce supercalifragilístico', 100, measure)).toEqual(['Desbroce', 'supercalifragilístico']);
  });

  it('recorta con «…» si sobran líneas', () => {
    const lines = clampLines(['uno dos', 'tres cuatro', 'cinco'], 2, 110, measure);
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith('…')).toBe(true);
    expect(measure(lines[1])).toBeLessThanOrEqual(110);
  });
});
