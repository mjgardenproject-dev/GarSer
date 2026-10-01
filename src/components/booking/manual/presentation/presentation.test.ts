import { describe, expect, it } from 'vitest';
import {
  getVisibleFields,
  MANUAL_ENTRY_SURVEYS,
  MANUAL_SERVICE_KEYS,
  type ManualAnswers,
} from '../../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_PARITY_FIXTURES } from '../../../../pages/reserva/manualEntryParityFixtures';
import { getManualPresentation } from './manualEntryPresentation';
import { describePresentationMismatch, getQuestionProgress, getVisibleScreens } from './screens';
import { formatManualValue, formatNumberEs } from './formatManualValue';

/** Lo que el asistente hacía antes de la capa de presentación: un paso visible = una pantalla. */
const legacyVisibleStepIds = (serviceKey: keyof typeof MANUAL_ENTRY_SURVEYS, answers: ManualAnswers) =>
  MANUAL_ENTRY_SURVEYS[serviceKey].steps.filter((step) => getVisibleFields(step, answers).length > 0).map((s) => s.id);

describe('presentación de los formularios manuales', () => {
  it.each(MANUAL_SERVICE_KEYS)('%s: cada paso del schema está en una sola pantalla y en el mismo orden', (key) => {
    expect(describePresentationMismatch(MANUAL_ENTRY_SURVEYS[key], getManualPresentation(key))).toBeNull();
  });

  // Desde F5 algunas pantallas reúnen varios pasos (setos: longitud + altura). Lo que no puede
  // cambiar es QUÉ se pregunta y en qué orden: los mismos pasos visibles, los mismos campos.
  it('las 88 respuestas de referencia ven los mismos pasos y campos, en el mismo orden, que antes', () => {
    let items = 0;
    for (const fixture of MANUAL_PARITY_FIXTURES) {
      const survey = MANUAL_ENTRY_SURVEYS[fixture.serviceKey];
      const presentation = getManualPresentation(fixture.serviceKey);
      // También con el elemento vacío (primera pantalla) y a medio responder.
      for (const answers of [{}, ...fixture.items]) {
        const screens = getVisibleScreens(survey, presentation, answers);
        const legacy = legacyVisibleStepIds(fixture.serviceKey, answers);
        expect(screens.flatMap((s) => s.stepIds)).toEqual(legacy);
        expect(screens.flatMap((s) => s.fields.map((f) => f.key))).toEqual(
          legacy.flatMap((id) => getVisibleFields(survey.steps.find((s) => s.id === id)!, answers).map((f) => f.key)),
        );
        items += 1;
      }
    }
    expect(items).toBeGreaterThan(88);
  });
});

describe('«Pregunta X de Y»', () => {
  it('césped: superficie, estado y retirada', () => {
    const survey = MANUAL_ENTRY_SURVEYS.lawn;
    const p = getManualPresentation('lawn');
    expect(getQuestionProgress(survey, p, {}, 'surface', { asksWaste: true })).toEqual({ current: 1, total: 3 });
    expect(getQuestionProgress(survey, p, {}, 'state', { asksWaste: true })).toEqual({ current: 2, total: 3 });
    expect(getQuestionProgress(survey, p, {}, 'waste', { asksWaste: true })).toEqual({ current: 3, total: 3 });
  });

  it('fitosanitarios: el total nunca crece mientras se responde (hoy pasaba de 4 a 5 y a 6)', () => {
    const survey = MANUAL_ENTRY_SURVEYS.phytosanitary;
    const p = getManualPresentation('phytosanitary');
    const path: Array<[string, ManualAnswers]> = [
      ['affected', {}],
      ['area', { affectedType: 'Árboles' }],
      ['size', { affectedType: 'Árboles', area: 3 }],
      ['intent', { affectedType: 'Árboles', area: 3, sizeBand: 'grandes' }],
      ['target', { affectedType: 'Árboles', area: 3, sizeBand: 'grandes', intent: 'curative' }],
      ['product', { affectedType: 'Árboles', area: 3, sizeBand: 'grandes', intent: 'curative', curativeTarget: 'fungus' }],
    ];
    const totals = path.map(([id, answers]) => getQuestionProgress(survey, p, answers, id, { asksWaste: false }));
    for (let i = 1; i < totals.length; i += 1) expect(totals[i].total).toBeLessThanOrEqual(totals[i - 1].total);
    expect(totals.map((t) => t.current)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(totals[totals.length - 1].total).toBe(6);
  });

  it('fitosanitarios preventivo sobre setos: sin tamaño, sin objetivo, con setos altos', () => {
    const survey = MANUAL_ENTRY_SURVEYS.phytosanitary;
    const p = getManualPresentation('phytosanitary');
    const answers = { affectedType: 'Setos', area: 20, intent: 'preventive', productPreference: 'chemical' };
    expect(getVisibleScreens(survey, p, answers).map((s) => s.id)).toEqual(['affected', 'area', 'intent', 'product', 'height']);
    expect(getQuestionProgress(survey, p, answers, 'height', { asksWaste: false })).toEqual({ current: 5, total: 5 });
  });
});

describe('formato es-ES', () => {
  it.each([
    [5000, '5.000'],
    [10000, '10.000'],
    [80, '80'],
    [2.3, '2,3'],
    [2.5, '2,5'],
    [1234.5, '1.234,5'],
    [0.3, '0,3'],
    [1000000, '1.000.000'],
    [2.345, '2,35'],
  ])('%s → «%s»', (value, expected) => {
    expect(formatNumberEs(value)).toBe(expected);
  });

  it('valores de la revisión: unidad, opción elegida y booleano por su etiqueta', () => {
    const hedgeHeight = MANUAL_ENTRY_SURVEYS.hedge.steps[1].fields[0];
    expect(formatManualValue(hedgeHeight, { altura_m: 2.3 })).toBe('2,3 m');
    const lawnArea = MANUAL_ENTRY_SURVEYS.lawn.steps[0].fields[0];
    expect(formatManualValue(lawnArea, { superficie_m2: 5000 })).toBe('5.000 m²');
    expect(formatManualValue(lawnArea, {})).toBe('—');
    const access = MANUAL_ENTRY_SURVEYS.tree.steps[2].fields[0];
    expect(formatManualValue(access, { difficultyHigh: false })).toBe('Acceso normal');
    expect(formatManualValue(access, { difficultyHigh: true })).toBe('Acceso difícil');
    expect(formatManualValue(access, {})).toBe('—');
    const herbicide = MANUAL_ENTRY_SURVEYS.weeding.steps[2].fields[0];
    expect(formatManualValue(herbicide, { applyHerbicide: true })).toBe('Sí');
    const palmHeight = MANUAL_ENTRY_SURVEYS.palm.steps[1].fields[0];
    expect(formatManualValue(palmHeight, { species: 'Phoenix canariensis', height: '>10m' })).toBe('Más de 10 m');
  });
});
