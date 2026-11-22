import { describe, expect, it } from 'vitest';
import { SERVICE_QUESTIONNAIRES } from './questionnaires';
import { isQuestionAnswered, previewQuotes, questionCountUpperBound, visibleQuestions, type Answers } from './pricingQuestions';
import { minutesToPerHour, palmBandLabel, perHourToMinutes, selectedPalmSpecies } from './unitQuestionnaires';

const tree = SERVICE_QUESTIONNAIRES['Poda de árboles']!;
const palm = SERVICE_QUESTIONNAIRES['Poda de palmeras']!;

const TREE_ANSWERS: Answers = {
  formacionSmall: 35, formacionMedium: 60, estructuralSmall: 45, estructuralMedium: 80,
  minFormacionSmall: 24, minFormacionMedium: 40, minEstructuralSmall: 30, minEstructuralMedium: 50,
  large: 'no', difficulty: 30, waste: 15, minimum: 60,
};

describe('minutos ↔ unidades por hora', () => {
  it('se convierten en los dos sentidos', () => {
    expect(minutesToPerHour(20)).toBe(3);
    expect(minutesToPerHour(40)).toBe(1.5);
    expect(perHourToMinutes(2.5)).toBe(24);
    expect(perHourToMinutes(0.8)).toBe(75);
    expect(perHourToMinutes(0)).toBeNull();
    expect(perHourToMinutes('x')).toBeNull();
  });
});

describe('poda de árboles', () => {
  it('sin árboles altos: guarda solo hasta 5 m, sin rastro de la banda grande aunque la hubiera antes', () => {
    const previous = { formacion: { small: 1, medium: 1, large: 110 }, estructural: { small: 1, medium: 1, large: 150 } };
    const config = tree.toConfig(TREE_ANSWERS, previous);
    expect(config.formacion).toEqual({ small: 35, medium: 60 });
    expect(config.estructural).toEqual({ small: 45, medium: 80 });
    expect(config.yield_units_per_hour).toEqual({ formacion: { small: 2.5, medium: 1.5 }, estructural: { small: 2, medium: 1.2 } });
    expect(tree.isValid(config)).toBe(true);
  });

  it('con árboles altos: precio y tiempo de la banda grande, o no es válida', () => {
    const withLarge = { ...TREE_ANSWERS, large: 'yes', formacionLarge: 110, estructuralLarge: 150, minFormacionLarge: 75, minEstructuralLarge: 100 };
    expect(tree.isValid(tree.toConfig(withLarge, undefined))).toBe(true);
    expect(tree.isValid(tree.toConfig({ ...withLarge, minEstructuralLarge: 0 }, undefined))).toBe(false);
  });

  it('dificultad y restos tienen que ser más de 0 (lo exige su validador): 0 no deja seguir', () => {
    const extras = tree.questions.find((q) => q.id === 'extras')!;
    expect(isQuestionAnswered(extras, { difficulty: 0, waste: 15 })).toBe(false);
    expect(isQuestionAnswered(extras, { difficulty: 30, waste: 15 })).toBe(true);
  });

  it('el ejemplo sale del motor: 3 de formación hasta 3 m = 3 × 35 €; difíciles y con restos, más', () => {
    const previews = previewQuotes(tree, tree.toConfig(TREE_ANSWERS, undefined));
    expect(previews[0].price).toBe(105);
    expect(previews[1].price).toBe(160);
    expect(previews[2].price).toBeGreaterThan(previews[1].price);
  });

  it('una cuenta sin árboles guardados pregunta si hace árboles altos (no lo supone)', () => {
    expect(tree.fromConfig({}).large).toBeNull();
    expect(tree.fromConfig(undefined).large).toBeNull();
  });
});

describe('poda de palmeras', () => {
  const base: Answers = {
    'species:Phoenix canariensis': true,
    method: 'per_quantity',
    'price:Phoenix canariensis:0-4': 45, 'price:Phoenix canariensis:4-10': 90, 'price:Phoenix canariensis:>10': 150,
    'min:Phoenix canariensis:0-4': 40, 'min:Phoenix canariensis:4-10': 75, 'min:Phoenix canariensis:>10': 120,
    descuidado: 20, muyDescuidado: 50, waste: 15, phytosanitary: 0, trunkFinish: 0, accessDifficulty: 0, minimum: 60,
  };

  it('solo pregunta por las especies marcadas, con sus alturas reales', () => {
    const species = visibleQuestions(palm, base).filter((q) => q.id.startsWith('palm:'));
    expect(species.map((q) => q.id)).toEqual(['palm:Phoenix canariensis']);
    expect(palmBandLabel('0-4')).toBe('De 0 a 4 m');
    expect(palmBandLabel('>10')).toBe('Más de 10 m');
    expect(selectedPalmSpecies(base)).toEqual(['Phoenix canariensis']);
  });

  it('guarda una configuración que el configurador da por buena y el motor calcula', () => {
    const config = palm.toConfig(base, undefined);
    expect(config.selected_species).toEqual(['Phoenix canariensis']);
    expect(config.waste_removal).toEqual({ option: 'extra_percentage', percentage: 15 });
    expect(palm.isValid(config)).toBe(true);
    const [two, careless, waste] = previewQuotes(palm, config);
    expect(two.price).toBe(90); // 2 × 45 €
    expect(careless.price).toBeGreaterThan(90); // 1 × 90 € + 20 %
    expect(waste.price).toBeGreaterThan(two.price);
  });

  it('por hora: no pide precios por palmera, pero deja las alturas (el validador las lee) y es válida', () => {
    const perHour: Answers = { ...base, method: 'per_hour', hourly: 30 };
    for (const key of Object.keys(perHour)) if (key.startsWith('price:')) delete perHour[key];
    const speciesScreen = visibleQuestions(palm, perHour).find((q) => q.id === 'palm:Phoenix canariensis')!;
    expect(isQuestionAnswered(speciesScreen, perHour)).toBe(true);
    const config = palm.toConfig(perHour, undefined);
    expect(Object.keys((config.height_prices as Record<string, object>)['Phoenix canariensis'])).toEqual(['0-4', '4-10', '>10']);
    expect(palm.isValid(config)).toBe(true);
    expect(previewQuotes(palm, config)[0].price).toBeGreaterThan(0);
  });

  it('recargos de estado y de restos en 0 no dejan seguir (su validador los exige)', () => {
    const states = palm.questions.find((q) => q.id === 'states')!;
    expect(isQuestionAnswered(states, { descuidado: 0, muyDescuidado: 50 })).toBe(false);
  });

  it('marcar más especies añade una pantalla por especie', () => {
    const one = questionCountUpperBound(palm, base);
    const two = questionCountUpperBound(palm, { ...base, 'species:Washingtonia robusta/filifera': true });
    expect(two).toBe(one + 1);
  });

  it('desmarcar una especie la quita de lo que se ofrece, sin borrar lo que tenía configurado', () => {
    const previous = palm.toConfig({ ...base, 'species:Trachycarpus fortunei': true, 'price:Trachycarpus fortunei:0-3': 35, 'price:Trachycarpus fortunei:3-6': 60, 'price:Trachycarpus fortunei:>6': 95, 'min:Trachycarpus fortunei:0-3': 30, 'min:Trachycarpus fortunei:3-6': 50, 'min:Trachycarpus fortunei:>6': 75 }, undefined);
    const config = palm.toConfig(base, previous);
    expect(config.selected_species).toEqual(['Phoenix canariensis']);
    expect((config.height_prices as Record<string, unknown>)['Trachycarpus fortunei']).toEqual({ '0-3': 35, '3-6': 60, '>6': 95 });
  });
});
