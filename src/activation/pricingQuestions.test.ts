import { describe, expect, it } from 'vitest';
import {
  SERVICE_QUESTIONNAIRES,
  isAnswered,
  isNumberValid,
  isQuestionAnswered,
  previewQuotes,
  questionCountUpperBound,
  visibleFields,
  visibleQuestions,
  type Answers,
  type NumberQuestion,
  type ServiceQuestionnaire,
} from './pricingQuestions';

// Configuraciones de la base de pruebas (supabase/seed.sql): lo que guarda el configurador hoy.
const SEED: Record<string, Record<string, unknown>> = {
  'Corte de césped': {
    pricing_method: 'per_quantity', price_per_m2: 0.18, precioPorHora: 28, yield_m2_per_hour: 150, minimum_price: 45,
    condition_surcharges: { descuidado: 20, muy_descuidado: 50 }, waste_removal: { percentage: 15 },
  },
  'Poda de setos': {
    pricing_method: 'per_quantity', pricing_matrix: { '0-2m': 3.5, '2-4m': 5.5, '4-6m': 8.0 },
    yield_ml_per_hour: { '0-2m': 25, '2-4m': 15, '4-6m': 8 }, precioPorHora: 30, minimum_price: 50,
    condition_surcharges: { media: 20, alta: 50 }, waste_removal: { percentage: 15 },
  },
  'Poda de plantas y arbustos': {
    pricing_method: 'per_quantity', prices_per_m2: { pequeñas: 4.5, medianas: 6.5, grandes: 9.0 },
    yield_m2_per_hour: { pequeñas: 12, medianas: 8, grandes: 5 }, precioPorHora: 30,
    condition_surcharges: { media: 20, alta: 50 }, waste_removal: { percentage: 15 }, minimum_price: 45,
  },
  'Desbroce de malas hierbas': {
    version: 'weeding_v1', precio_desbroce_m2: 0.35, precio_herbicida_m2: 0.15, yield_m2_per_hour: 120,
    suplementos: { dificultad_media: 20, dificultad_alta: 50, retirada_restos: 20 }, importe_minimo: 60,
  },
};

const q = (name: string) => SERVICE_QUESTIONNAIRES[name as keyof typeof SERVICE_QUESTIONNAIRES] as ServiceQuestionnaire;

/** Contesta todas las preguntas visibles con el primer valor sugerido (o la primera opción). */
function answerAll(questionnaire: ServiceQuestionnaire, start: Answers = {}): Answers {
  const answers: Answers = { ...start };
  for (let guard = 0; guard < 50; guard += 1) {
    const pending = visibleQuestions(questionnaire, answers).find((question) => !isQuestionAnswered(question, answers));
    if (!pending) return answers;
    if (pending.kind === 'choice') answers[pending.id] = pending.options[0].value;
    else if (pending.kind === 'number') answers[pending.id] = pending.suggestions.find((v) => v > 0) ?? 1;
    else {
      for (const field of visibleFields(pending, answers)) {
        if (!isNumberValid(field, answers[field.id])) answers[field.id] = field.suggestions.find((v) => v > 0) ?? 1;
      }
    }
  }
  throw new Error('no termina');
}

describe.each(Object.keys(SEED))('%s', (name) => {
  const questionnaire = q(name);

  it('lo guardado por el configurador se recupera como respuestas y vuelve a dar una configuración válida igual', () => {
    const answers = questionnaire.fromConfig(SEED[name]);
    for (const question of visibleQuestions(questionnaire, answers)) {
      if (question.id === 'high') continue; // setos de pruebas sin `specialist_enabled`: se pregunta
      expect(isQuestionAnswered(question, answers), question.id).toBe(true);
    }
    const config = questionnaire.toConfig({ ...answers, high: answers.high ?? 'yes' }, SEED[name]);
    expect(questionnaire.isValid(config)).toBe(true);
  });

  it('sin configuración previa, contestando todo, sale una configuración que el configurador da por buena', () => {
    const config = questionnaire.toConfig(answerAll(questionnaire), undefined);
    expect(questionnaire.isValid(config)).toBe(true);
  });

  it('el ejemplo de presupuesto sale del motor real, con precio y horas de agenda', () => {
    const config = questionnaire.toConfig(answerAll(questionnaire), undefined);
    const previews = previewQuotes(questionnaire, config);
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview.price).toBeGreaterThan(0);
      expect(preview.agendaHours).toBeGreaterThanOrEqual(1);
    }
  });

  it('con mínimo 0 o sin rendimiento NO es válida (el configurador tampoco la aceptaría)', () => {
    const answers = answerAll(questionnaire);
    expect(questionnaire.isValid(questionnaire.toConfig({ ...answers, minimum: 0 }, undefined))).toBe(false);
    const yieldKey = Object.keys(answers).find((key) => key.startsWith('yield'))!;
    expect(questionnaire.isValid(questionnaire.toConfig({ ...answers, [yieldKey]: 0 }, undefined))).toBe(false);
  });
});

describe('detalles por servicio', () => {
  it('césped por hora: precio = horas × tarifa (motor real) y conserva el precio por m² anterior', () => {
    const lawn = q('Corte de césped');
    const config = lawn.toConfig(
      { method: 'per_hour', hourly: 30, yield: 150, descuidado: 20, muyDescuidado: 50, waste: 0, minimum: 10 },
      SEED['Corte de césped'],
    );
    expect(config.pricing_method).toBe('per_hour');
    expect(config.precioPorHora).toBe(30);
    expect(config.price_per_m2).toBe(0.18);
    const [normal, careless] = previewQuotes(lawn, config);
    // 400 m² / 150 m²/h = 2,67 h → 3 h (medias horas hacia arriba) × 30 €
    expect(normal.price).toBe(90);
    expect(normal.agendaHours).toBe(3);
    expect(careless.price).toBeGreaterThan(normal.price); // el 20 % sube tiempo y precio
    expect(normal.isMinimum).toBe(false);
  });

  it('césped: el estado sube el precio con el % del profesional', () => {
    const lawn = q('Corte de césped');
    const config = lawn.toConfig({ method: 'per_quantity', perM2: 0.2, yield: 150, descuidado: 50, muyDescuidado: 80, waste: 10, minimum: 1 }, undefined);
    const [normal, careless, withWaste] = previewQuotes(lawn, config);
    expect(normal.price).toBe(80); // 400 × 0,20
    expect(careless.price).toBe(120); // +50 %
    expect(withWaste.price).toBe(88); // +10 %
  });

  it('avisa cuando lo que se cobra es el mínimo del profesional', () => {
    const lawn = q('Corte de césped');
    const config = lawn.toConfig({ method: 'per_quantity', perM2: 0.05, yield: 150, descuidado: 0, muyDescuidado: 0, waste: 0, minimum: 60 }, undefined);
    const [normal] = previewQuotes(lawn, config);
    expect(normal.price).toBe(60); // 400 × 0,05 = 20 € → mínimo 60 €
    expect(normal.isMinimum).toBe(true);
  });

  it('setos: «más de 4 m» activa la banda alta; si no, queda fuera sin romper las demás', () => {
    const hedge = q('Poda de setos');
    const base = answerAll(hedge, { method: 'per_quantity', high: 'no' });
    const without = hedge.toConfig(base, undefined);
    expect(without.specialist_enabled).toBe(false);
    expect((without.pricing_matrix as Record<string, number>)['4-6m']).toBe(0);
    expect(hedge.isValid(without)).toBe(true);

    const withHigh = hedge.toConfig(answerAll(hedge, { method: 'per_quantity', high: 'yes' }), undefined);
    expect(withHigh.specialist_enabled).toBe(true);
    expect((withHigh.pricing_matrix as Record<string, number>)['4-6m']).toBeGreaterThan(0);
    expect((withHigh.yield_ml_per_hour as Record<string, number>)['4-6m']).toBeGreaterThan(0);
    expect(hedge.isValid(withHigh)).toBe(true);
  });

  it('setos: con «más de 4 m» pero sin su rendimiento, no es válida', () => {
    const hedge = q('Poda de setos');
    const answers = answerAll(hedge, { method: 'per_quantity', high: 'yes' });
    expect(hedge.isValid(hedge.toConfig({ ...answers, yieldHigh: 0 }, undefined))).toBe(false);
  });

  it('arbustos: «descuidado» se guarda en `media` y «muy descuidado» en `alta` (nombres del motor)', () => {
    const shrub = q('Poda de plantas y arbustos');
    const config = shrub.toConfig(answerAll(shrub, { method: 'per_quantity', descuidado: 15, muyDescuidado: 45 }), undefined);
    expect(config.condition_surcharges).toEqual({ media: 15, alta: 45 });
    expect(shrub.fromConfig(config)).toMatchObject({ descuidado: 15, muyDescuidado: 45 });
  });

  it('desbroce: conserva el precio del herbicida que ya tuviera (se pregunta aparte, con carnet)', () => {
    const weeding = q('Desbroce de malas hierbas');
    const config = weeding.toConfig(weeding.fromConfig(SEED['Desbroce de malas hierbas']), SEED['Desbroce de malas hierbas']);
    expect(config.precio_herbicida_m2).toBe(0.15);
    expect(config.version).toBe('weeding_v1');
  });

  it('una configuración rara o vacía no rompe: no hay respuestas inventadas', () => {
    for (const questionnaire of Object.values(SERVICE_QUESTIONNAIRES)) {
      const answers = questionnaire!.fromConfig({ pricing_method: 'otra', yield_m2_per_hour: -3, minimum_price: 'x' });
      expect(Object.values(answers).every((v) => v === null)).toBe(true);
      expect(questionnaire!.fromConfig(null)).toBeTruthy();
    }
  });
});

describe('cuántas preguntas tiene un servicio', () => {
  it('cuenta con la opción que más preguntas abre, y no sube al elegir', () => {
    const hedge = q('Poda de setos');
    const before = questionCountUpperBound(hedge, {});
    // setos: por metro (2 precios) y con «más de 4 m» (2 preguntas más) es el recorrido más largo
    expect(before).toBe(visibleQuestions(hedge, { method: 'per_quantity', high: 'yes' }).length);
    expect(questionCountUpperBound(hedge, { method: 'per_hour' })).toBeLessThanOrEqual(before);
    expect(questionCountUpperBound(hedge, { method: 'per_quantity', high: 'no' })).toBeLessThan(before);
  });
});

describe('pantallas con varios números', () => {
  it('cuentan como contestadas solo con todos sus campos visibles bien', () => {
    const hedge = q('Poda de setos');
    const highBand = hedge.questions.find((question) => question.id === 'highBand')!;
    // Por hora: solo se ve «metros por hora» (el precio por metro no aplica)
    expect(isQuestionAnswered(highBand, { method: 'per_hour', high: 'yes', yieldHigh: 8 })).toBe(true);
    // Por metro: hacen falta los dos
    expect(isQuestionAnswered(highBand, { method: 'per_quantity', high: 'yes', yieldHigh: 8 })).toBe(false);
    expect(isQuestionAnswered(highBand, { method: 'per_quantity', high: 'yes', yieldHigh: 8, priceHigh: 9 })).toBe(true);
  });

  it('césped cabe en 6 pantallas cobrando por hora (antes 7) y setos en 8 como mucho (antes 12)', () => {
    expect(visibleQuestions(q('Corte de césped'), { method: 'per_hour' })).toHaveLength(6);
    expect(questionCountUpperBound(q('Poda de setos'), {})).toBe(8);
  });
});

describe('isAnswered', () => {
  const money: NumberQuestion = { id: 'm', kind: 'number', title: '', unit: '€', suggestions: [], min: 1, max: 100 };
  const percent: NumberQuestion = { id: 'p', kind: 'number', title: '', unit: '%', suggestions: [], allowZero: true, max: 300 };

  it('precios: más de 0, dentro de los límites', () => {
    expect(isAnswered(money, 1)).toBe(true);
    expect(isAnswered(money, 0.5)).toBe(false);
    expect(isAnswered(money, 0)).toBe(false);
    expect(isAnswered(money, 101)).toBe(false);
    expect(isAnswered(money, null)).toBe(false);
    expect(isAnswered(money, Number.NaN)).toBe(false);
  });

  it('recargos: 0 vale, negativo no', () => {
    expect(isAnswered(percent, 0)).toBe(true);
    expect(isAnswered(percent, -1)).toBe(false);
    expect(isAnswered(percent, 301)).toBe(false);
  });
});
