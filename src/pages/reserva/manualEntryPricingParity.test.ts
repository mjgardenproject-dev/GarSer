/**
 * Paridad de precio de la entrada manual (ronda de rediseño UX 2026-09-29).
 *
 * Congela, para cada respuesta de referencia de `manualEntryParityFixtures.ts`:
 *   1. lo que se envía: el `patch` de `buildManualBookingPatch` y sus `declaredVariables`;
 *   2. lo que se cobra: el presupuesto completo de `buildAuthoritativeBookingQuote`.
 *
 * El rediseño solo toca la presentación, así que estos snapshots NO deben cambiar en ninguna
 * fase. NO ejecutes `vitest -u` sobre este archivo salvo en un paso del plan que prevea el
 * cambio y lo documente (hoy, solo 4.3-D1: cantidad de árboles), revisando el diff a mano.
 *
 * El segundo bloque comprueba que las respuestas de referencia cubren todas las ramas del
 * formulario: cada opción de cada campo, los dos valores de cada interruptor, los extremos
 * de cada rango y la retirada activada y desactivada. Si alguien añade una opción al esquema
 * sin añadir una respuesta que la use, falla aquí.
 */
import { describe, expect, it } from 'vitest';
import { buildManualBookingPatch } from './manualEntryBuilders';
import { buildAuthoritativeBookingQuote } from '../../shared/bookingQuoteCore';
import {
  getFieldOptions,
  MANUAL_ENTRY_SURVEYS,
  MANUAL_SERVICE_KEYS,
  serviceAsksForWasteRemoval,
} from '../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES, MANUAL_PARITY_PROVIDER_CONFIGS } from './manualEntryParityFixtures';

/** Los ids llevan `Date.now()`: es lo único no determinista del resultado. */
const MANUAL_ID = /^manual-([a-z]+)-(\d+)-\d+$/;
function stable<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, raw) =>
      typeof raw === 'string' && MANUAL_ID.test(raw) ? raw.replace(MANUAL_ID, 'manual-$1-$2-<ts>') : raw,
    ),
  );
}

describe('paridad de precio de la entrada manual', () => {
  it('los ids de las respuestas de referencia son únicos', () => {
    const ids = MANUAL_PARITY_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  MANUAL_PARITY_FIXTURES.forEach((fixture) => {
    it(fixture.id, () => {
      const { patch, declaredVariables } = buildManualBookingPatch({
        serviceKey: fixture.serviceKey,
        items: fixture.items,
        wasteRemoval: fixture.wasteRemoval,
      });
      const quote = buildAuthoritativeBookingQuote({
        bookingData: patch as never,
        providerConfig: MANUAL_PARITY_PROVIDER_CONFIGS[fixture.serviceKey],
      });
      // Una configuración de prueba mal formada daría presupuestos a cero y snapshots que no
      // protegen nada: toda respuesta de referencia tiene que ser cotizable.
      expect(quote.eligibility.isEligible).toBe(true);
      expect(quote.totalPrice).toBeGreaterThan(0);
      expect(stable({ patch, declaredVariables, quote })).toMatchSnapshot();
    });
  });
});

describe('las respuestas de referencia cubren todas las ramas del formulario', () => {
  MANUAL_SERVICE_KEYS.forEach((serviceKey) => {
    it(serviceKey, () => {
      const survey = MANUAL_ENTRY_SURVEYS[serviceKey];
      const fixtures = MANUAL_PARITY_FIXTURES.filter((fixture) => fixture.serviceKey === serviceKey);
      const items = fixtures.flatMap((fixture) => fixture.items);
      const missing: string[] = [];

      survey.steps.forEach((step) =>
        step.fields.forEach((field) => {
          const visibleIn = items.filter((item) => (field.visibleWhen ? field.visibleWhen(item) : true));
          if (visibleIn.length === 0) {
            missing.push(`${field.key}: nunca visible`);
            return;
          }
          if (field.type === 'enum') {
            // Cada opción, en un contexto en el que esa opción existe (p. ej. tramos por especie).
            const wanted = new Set<string>();
            visibleIn.forEach((item) => getFieldOptions(field, item).forEach((option) => wanted.add(option.value)));
            items.forEach((item) => {
              if (field.dynamicOptions) return;
              getFieldOptions(field, item).forEach((option) => wanted.add(option.value));
            });
            wanted.forEach((value) => {
              const used = visibleIn.some(
                (item) => item[field.key] === value && getFieldOptions(field, item).some((option) => option.value === value),
              );
              if (!used) missing.push(`${field.key} = ${value}`);
            });
          }
          if (field.type === 'boolean') {
            [true, false].forEach((value) => {
              if (!visibleIn.some((item) => item[field.key] === value)) missing.push(`${field.key} = ${value}`);
            });
          }
          if (field.type === 'number' || field.type === 'integer') {
            [field.min, field.max].forEach((bound) => {
              if (typeof bound === 'number' && !visibleIn.some((item) => item[field.key] === bound)) {
                missing.push(`${field.key} = ${bound}`);
              }
            });
          }
        }),
      );

      if (serviceAsksForWasteRemoval(serviceKey)) {
        [true, false].forEach((value) => {
          if (!fixtures.some((fixture) => fixture.wasteRemoval === value)) missing.push(`wasteRemoval = ${value}`);
        });
      }
      if (survey.repeatable && !fixtures.some((fixture) => fixture.items.length > 1)) {
        missing.push('varios elementos');
      }

      expect(missing).toEqual([]);
    });
  });
});
