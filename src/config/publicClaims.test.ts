import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guardia de afirmaciones: frases que ya fueron falsas (o dependen de los ajustes de comisiones) y
 * no pueden volver a colarse en un texto fijo.
 *
 * Recorre el código fuente y busca frases prohibidas. Lo que depende de los ajustes sale de
 * `config/billingCopy.ts`; lo que depende de la reserva concreta, de los importes de esa reserva.
 */

const ROOT = path.resolve(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === 'node_modules' || name === 'generated') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|html)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');
const SOURCES = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'supabase', 'functions')), path.join(ROOT, 'index.html')];
const read = (file: string) => readFileSync(file, 'utf8');

/** Quita los comentarios (// y /* *\/): lo que importa es el texto que ve el usuario. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function offenders(pattern: RegExp, scope: (file: string) => boolean): string[] {
  return SOURCES.filter((file) => scope(rel(file))).filter((file) => pattern.test(withoutComments(read(file)))).map(rel);
}

describe('afirmaciones que no pueden volver', () => {
  it('«en un minuto»: una reserva nueva no se hace en un minuto', () => {
    // El aviso de la reseña («solo te llevará un minuto») y el carnet («tardas un minuto») sí son ciertos.
    expect(offenders(/reserva(r|s)?[^'"`\n]{0,40}en un minuto|en un minuto[^'"`\n]{0,30}reserva/i, () => true)).toEqual([]);
  });

  it('«sin comisión» / «sin gastos de gestión» en un texto fijo de cara al público o en lo que se imprime', () => {
    const scope = (f: string) =>
      f === 'index.html'
      || f === 'src/config/publicSiteContent.ts'
      || f.startsWith('src/utils/marketing/')
      || f.startsWith('src/pages/public/')
      || f === 'src/components/public/CustomerExperienceSections.tsx';
    expect(offenders(/sin comisi[oó]n|sin pagar comisi[oó]n|sin gastos de gesti[oó]n/i, scope)).toEqual([]);
  });

  it('los materiales que se imprimen o se descargan no hablan de gastos de gestión ni de comisiones', () => {
    expect(offenders(/gastos de gesti[oó]n|comisi[oó]n|gratis|gratuit/i, (f) => f.startsWith('src/utils/marketing/'))).toEqual([]);
  });

  it('«No se te ha cobrado nada» tras cancelar: depende de quién cancela y de la antelación', () => {
    // Excepción deliberada (QA-139): el pago que NO llega a crear reserva. Ahí no hay nada que
    // cancelar ni ninguna política de antelación: la retención de la tarjeta se anula siempre
    // (booking-payment, webhook y reloj, `_shared/orphanPaymentRelease.ts`), así que la frase es
    // cierta. Solo vale en la pantalla de pago y en sus textos; en reservas existentes sigue prohibida.
    // Las apariciones permitidas se cuentan una a una: una frase nueva en esos archivos hace fallar
    // la guardia y obliga a comprobar que también es cierta.
    const allowed: Record<string, number> = {
      'src/shared/bookingPaymentCore.ts': 2, // pago sin reserva: retención anulada (específico y genérico)
      // «Tiempo agotado» antes de pagar, y servicio desactivado (QA-181: el intento de pago no llega a
      // crearse, la base de datos lo rechaza antes de hablar con Stripe): instrucción y aviso.
      'src/pages/reserva/ConfirmationPage.tsx': 3,
      'src/components/booking/EmbeddedStripePaymentForm.tsx': 1, // el banco rechazó la tarjeta
    };
    expect(offenders(/No se te ha cobrado nada|queda liberada/, (f) => f.startsWith('src/') && !(f in allowed))).toEqual([]);
    for (const [file, count] of Object.entries(allowed)) {
      const found = withoutComments(read(path.join(ROOT, file))).match(/No se te ha cobrado nada|queda liberada/g) ?? [];
      expect({ file, count: found.length }).toEqual({ file, count });
    }
  });

  it('«Hay más profesionales disponibles»: no se sabe si los hay', () => {
    expect(offenders(/Hay más profesionales disponibles/, () => true)).toEqual([]);
  });

  it('el plazo de un reembolso con tarjeta no es de 3 a 5 días hábiles', () => {
    expect(offenders(/entre 3 y 5 días hábiles/, () => true)).toEqual([]);
  });

  it('«más de 24 horas»: la devolución es con 24 horas o más (`>= interval \'24 hours\'`)', () => {
    expect(offenders(/(con|Faltan) más de 24 ?h/i, (f) => f.startsWith('src/') || f.startsWith('supabase/functions/'))).toEqual([]);
  });

  it('el cliente que vuelve «deja de pagar» solo lo dice billingCopy, según los ajustes', () => {
    expect(offenders(/deja de pagar gastos de gesti[oó]n|ya no (paga|pagan) gastos/i, (f) => f !== 'src/config/billingCopy.ts' && f.startsWith('src/'))).toEqual([]);
  });
});
