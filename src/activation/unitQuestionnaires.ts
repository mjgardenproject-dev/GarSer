import type { PalmPricingConfig, PalmSpecies } from '../types';
import type { TreeHeightBandPricing, TreePruningServiceConfig } from '../types/treePruning';
import { isPalmConfigValid, isTreePruningConfigValid } from '../utils/serviceValidation';
import { PALM_CANONICAL_SPECIES, PALM_SPECIES_HEIGHT_BANDS, type PalmCanonicalSpecies } from '../domain/speciesBusinessRules';
import {
  hourlyQuestion,
  isPerHour,
  isPerQuantity,
  methodQuestion,
  minimumQuestion,
  n0,
  nonNegative,
  obj,
  positive,
  STATE_HELP,
  type Answers,
  type MultiNumberQuestion,
  type NumberField,
  type ServiceQuestionnaire,
} from './pricingQuestions';
import { SUGGESTED } from './suggestedValues';

// Tarifas de árboles y palmeras en el cuestionario «Activa tu cuenta» (2026-11-11). Son servicios por
// UNIDAD: el rendimiento se pregunta como «¿cuántos minutos tardas en uno?», que se entiende mejor, y se
// guarda como unidades por hora (60 / minutos), que es lo que usa el motor.
//
// Reglas de sus validadores (serviceValidation.ts) que aquí se respetan: árboles exige dificultad y
// retirada de restos > 0 y la banda de más de 5 m coherente (precio y tiempo, o ninguno); palmeras exige
// recargos de estado y de restos > 0 y precio y tiempo en todas las alturas de cada especie elegida.

/** Minutos por unidad → unidades por hora (lo que guarda el configurador). */
export const minutesToPerHour = (minutes: number): number => Math.round((60 / minutes) * 1000) / 1000;
/** Unidades por hora → minutos por unidad (para enseñar lo ya guardado). */
export const perHourToMinutes = (perHour: unknown): number | null => {
  const p = positive(perHour);
  return p === null ? null : Math.max(1, Math.round(60 / p));
};

const WHY_MINUTES =
  'Lo usamos para calcular cuánto dura cada trabajo y reservarte ese tiempo en la agenda, ni más ni menos.';

const strictPercent = (id: string, label: string, suggestions: readonly number[]): NumberField => ({
  id,
  label,
  unit: '%',
  suggestions,
  min: 1,
  max: 300,
});

// ── Poda de árboles (solo precio por árbol) ────────────────────────────────────────────────────────

const wantsLarge = (a: Answers) => a.large === 'yes';

const tree: ServiceQuestionnaire = {
  service: 'Poda de árboles',
  questions: [
    {
      id: 'formacion', kind: 'multi', title: '¿Cuánto cobras por árbol en una poda de formación?',
      help: 'Formación: árboles jóvenes o mantenimiento ligero.',
      fields: [
        { id: 'formacionSmall', label: 'Hasta 3 m de alto', unit: '€/árbol', suggestions: SUGGESTED.tree.formacionSmall, max: 2000 },
        { id: 'formacionMedium', label: 'De 3 a 5 m de alto', unit: '€/árbol', suggestions: SUGGESTED.tree.formacionMedium, max: 2000 },
      ],
    },
    {
      id: 'estructural', kind: 'multi', title: '¿Y en una poda estructural?',
      help: 'Estructural: árboles grandes, ramas pesadas o saneamiento profundo.',
      fields: [
        { id: 'estructuralSmall', label: 'Hasta 3 m de alto', unit: '€/árbol', suggestions: SUGGESTED.tree.estructuralSmall, max: 2000 },
        { id: 'estructuralMedium', label: 'De 3 a 5 m de alto', unit: '€/árbol', suggestions: SUGGESTED.tree.estructuralMedium, max: 2000 },
      ],
    },
    {
      id: 'minutes', kind: 'multi', title: '¿Cuántos minutos tardas en cada árbol, más o menos?', why: WHY_MINUTES,
      fields: [
        { id: 'minFormacionSmall', label: 'Formación, hasta 3 m', unit: 'min', suggestions: SUGGESTED.tree.minutesSmall, max: 600 },
        { id: 'minFormacionMedium', label: 'Formación, de 3 a 5 m', unit: 'min', suggestions: SUGGESTED.tree.minutesMedium, max: 600 },
        { id: 'minEstructuralSmall', label: 'Estructural, hasta 3 m', unit: 'min', suggestions: SUGGESTED.tree.minutesSmall, max: 600 },
        { id: 'minEstructuralMedium', label: 'Estructural, de 3 a 5 m', unit: 'min', suggestions: SUGGESTED.tree.minutesMedium, max: 600 },
      ],
    },
    {
      id: 'large', kind: 'choice', title: '¿Podas árboles de más de 5 m de alto?',
      options: [
        { value: 'yes', label: 'Sí', detail: 'Te preguntamos su precio y cuánto tardas.' },
        { value: 'no', label: 'No', detail: 'No te llegarán esos trabajos; el resto, sí.' },
      ],
    },
    {
      id: 'largeBand', kind: 'multi', title: 'Árboles de más de 5 m', help: 'También cubre los de más de 9 m.', why: WHY_MINUTES, when: wantsLarge,
      fields: [
        { id: 'formacionLarge', label: 'Formación · precio por árbol', unit: '€/árbol', suggestions: SUGGESTED.tree.formacionLarge, max: 5000 },
        { id: 'estructuralLarge', label: 'Estructural · precio por árbol', unit: '€/árbol', suggestions: SUGGESTED.tree.estructuralLarge, max: 5000 },
        { id: 'minFormacionLarge', label: 'Formación · minutos por árbol', unit: 'min', suggestions: SUGGESTED.tree.minutesLarge, max: 1440 },
        { id: 'minEstructuralLarge', label: 'Estructural · minutos por árbol', unit: 'min', suggestions: SUGGESTED.tree.minutesLarge, max: 1440 },
      ],
    },
    {
      id: 'extras', kind: 'multi', title: '¿Cuánto más cobras en estos casos?', help: STATE_HELP,
      fields: [
        strictPercent('difficulty', 'Árbol difícil (lo confirma el cliente)', SUGGESTED.tree.difficulty),
        strictPercent('waste', 'Llevarte los restos', SUGGESTED.tree.waste.filter((v) => v > 0)),
      ],
    },
    minimumQuestion(SUGGESTED.tree.minimum),
  ],
  fromConfig: (raw) => {
    const c = obj(raw);
    const f = obj(c.formacion);
    const e = obj(c.estructural);
    const y = obj(c.yield_units_per_hour);
    const yf = obj(y.formacion);
    const ye = obj(y.estructural);
    const hasLarge = positive(f.large) !== null || positive(e.large) !== null;
    return {
      formacionSmall: positive(f.small),
      formacionMedium: positive(f.medium),
      estructuralSmall: positive(e.small),
      estructuralMedium: positive(e.medium),
      minFormacionSmall: perHourToMinutes(yf.small),
      minFormacionMedium: perHourToMinutes(yf.medium),
      minEstructuralSmall: perHourToMinutes(ye.small),
      minEstructuralMedium: perHourToMinutes(ye.medium),
      // Sin precios guardados no se sabe si hace árboles altos: se pregunta.
      large: positive(f.small) === null ? null : hasLarge ? 'yes' : 'no',
      formacionLarge: positive(f.large),
      estructuralLarge: positive(e.large),
      minFormacionLarge: perHourToMinutes(yf.large),
      minEstructuralLarge: perHourToMinutes(ye.large),
      difficulty: positive(c.difficultyIncrease),
      waste: positive(c.wasteRemovalMultiplier),
      minimum: positive(c.minimumPrice),
    };
  },
  toConfig: (a, previous) => {
    const prev = obj(previous);
    const large = wantsLarge(a);
    const band = (small: number, medium: number, big: number | undefined): TreeHeightBandPricing =>
      big === undefined ? { small, medium } : { small, medium, large: big };
    const perHour = (minutes: unknown) => (typeof minutes === 'number' && minutes > 0 ? minutesToPerHour(minutes) : 0);
    const config: TreePruningServiceConfig & Record<string, unknown> = {
      ...prev,
      pricing_method: 'per_quantity',
      formacion: band(n0(a.formacionSmall), n0(a.formacionMedium), large ? n0(a.formacionLarge) : undefined),
      estructural: band(n0(a.estructuralSmall), n0(a.estructuralMedium), large ? n0(a.estructuralLarge) : undefined),
      yield_units_per_hour: {
        formacion: band(perHour(a.minFormacionSmall), perHour(a.minFormacionMedium), large ? perHour(a.minFormacionLarge) : undefined),
        estructural: band(perHour(a.minEstructuralSmall), perHour(a.minEstructuralMedium), large ? perHour(a.minEstructuralLarge) : undefined),
      },
      difficultyIncrease: n0(a.difficulty),
      wasteRemovalMultiplier: n0(a.waste),
      minimumPrice: n0(a.minimum),
    };
    return config;
  },
  isValid: (c) => isTreePruningConfigValid(c as unknown as TreePruningServiceConfig),
  examples: () => [
    { label: '3 árboles de hasta 3 m, poda de formación', bookingData: { treeGroups: [{ id: 'ej1', pruningType: 'formacion', quantity: 3, aiSizeBand: 'small' }], wasteRemoval: false } },
    { label: '2 árboles de 3 a 5 m, poda estructural', bookingData: { treeGroups: [{ id: 'ej2', pruningType: 'estructural', quantity: 2, aiSizeBand: 'medium' }], wasteRemoval: false } },
    { label: 'Los mismos 2, difíciles y llevándote los restos', bookingData: { treeGroups: [{ id: 'ej3', pruningType: 'estructural', quantity: 2, aiSizeBand: 'medium', difficultyHigh: true }], wasteRemoval: true } },
  ],
};

// ── Poda de palmeras ───────────────────────────────────────────────────────────────────────────────

/** Nombre que entiende cualquiera (y el latín, entre paréntesis, en la pantalla). */
export const PALM_COMMON_NAMES: Record<PalmCanonicalSpecies, string> = {
  'Phoenix canariensis': 'Palmera canaria',
  'Phoenix dactylifera': 'Palmera datilera',
  'Washingtonia robusta/filifera': 'Washingtonia',
  'Syagrus romanzoffiana': 'Pindó (Syagrus)',
  'Trachycarpus fortunei': 'Palmera de molino (Trachycarpus)',
  'Roystonea regia': 'Palmera real (Roystonea)',
};

const speciesKey = (species: PalmCanonicalSpecies) => `species:${species}`;
const isSelected = (a: Answers, species: PalmCanonicalSpecies) => a[speciesKey(species)] === true;
export const selectedPalmSpecies = (a: Answers): PalmCanonicalSpecies[] => PALM_CANONICAL_SPECIES.filter((sp) => isSelected(a, sp));

/** «0-4» → «De 0 a 4 m»; «>10» → «Más de 10 m». */
export const palmBandLabel = (band: string): string => {
  if (band.startsWith('>')) return `Más de ${band.slice(1)} m`;
  const [from, to] = band.split('-');
  return `De ${from} a ${to} m`;
};

const bandSuggestions = (index: number, kind: 'price' | 'minutes') => {
  const level = (['Low', 'Mid', 'High', 'Top'] as const)[Math.min(index, 3)];
  return kind === 'price' ? SUGGESTED.palm[`perPalm${level}`] : SUGGESTED.palm[`minutes${level}`];
};

const fieldId = (kind: 'price' | 'min', species: PalmCanonicalSpecies, band: string) => `${kind}:${species}:${band}`;

const speciesQuestion = (species: PalmCanonicalSpecies): MultiNumberQuestion => ({
  id: `palm:${species}`,
  kind: 'multi',
  title: `${PALM_COMMON_NAMES[species]}`,
  help: (a) =>
    isPerQuantity(a)
      ? `Precio por palmera y minutos que tardas en cada una, según lo alta que sea (${species}).`
      : `Minutos que tardas en cada palmera, según lo alta que sea (${species}).`,
  why: WHY_MINUTES,
  when: (a) => isSelected(a, species),
  fields: PALM_SPECIES_HEIGHT_BANDS[species].flatMap((band, index): NumberField[] => [
    {
      id: fieldId('price', species, band),
      label: `${palmBandLabel(band)} · precio por palmera`,
      unit: '€',
      suggestions: bandSuggestions(index, 'price'),
      max: 5000,
      when: isPerQuantity,
    },
    {
      id: fieldId('min', species, band),
      label: `${palmBandLabel(band)} · minutos por palmera`,
      unit: 'min',
      suggestions: bandSuggestions(index, 'minutes'),
      max: 1440,
    },
  ]),
});

const palm: ServiceQuestionnaire = {
  service: 'Poda de palmeras',
  questions: [
    {
      id: 'species', kind: 'checklist', title: '¿Qué palmeras podas?', help: 'Marca todas. Después te preguntamos por cada una.',
      options: PALM_CANONICAL_SPECIES.map((species) => ({ value: speciesKey(species), label: PALM_COMMON_NAMES[species], detail: species })),
    },
    methodQuestion('Por palmera', 'Un precio por palmera, según su especie y lo alta que sea.'),
    hourlyQuestion(SUGGESTED.palm.hourly),
    ...PALM_CANONICAL_SPECIES.map(speciesQuestion),
    {
      id: 'states', kind: 'multi', title: 'Si la palmera está descuidada, ¿cuánto más supone?', help: STATE_HELP,
      fields: [
        strictPercent('descuidado', 'Descuidada', SUGGESTED.palm.descuidado),
        strictPercent('muyDescuidado', 'Muy descuidada', SUGGESTED.palm.muyDescuidado),
      ],
    },
    {
      id: 'wasteQ', kind: 'multi', title: 'Si el cliente quiere que te lleves los restos, ¿cuánto más cobras?', help: 'En palmeras, la retirada de restos siempre lleva un extra.',
      fields: [strictPercent('waste', 'Retirada de restos', SUGGESTED.palm.waste.filter((v) => v > 0))],
    },
    {
      id: 'extras', kind: 'multi', title: 'Extras (opcionales)', help: 'Pon 0 en lo que no hagas. Solo se ofrecen en las especies que lo admiten.',
      fields: [
        { id: 'phytosanitary', label: 'Tratamiento fitosanitario, por palmera', unit: '€', suggestions: SUGGESTED.palm.phytosanitary, allowZero: true, max: 1000 },
        { id: 'trunkFinish', label: 'Acabado del tronco', unit: '%', suggestions: SUGGESTED.palm.trunkFinish, allowZero: true, max: 300 },
        { id: 'accessDifficulty', label: 'Acceso difícil (no en las más bajas)', unit: '%', suggestions: SUGGESTED.palm.accessDifficulty, allowZero: true, max: 300 },
      ],
    },
    minimumQuestion(SUGGESTED.palm.minimum),
  ],
  fromConfig: (raw) => {
    const c = obj(raw);
    const selected = Array.isArray(c.selected_species) ? (c.selected_species as string[]) : [];
    const prices = obj(c.height_prices);
    const yields = obj(c.yield_units_per_hour);
    const answers: Answers = {
      method: c.pricing_method === 'per_hour' ? 'per_hour' : c.pricing_method === 'per_quantity' ? 'per_quantity' : null,
      hourly: positive(c.precioPorHora ?? c.hourly_rate),
      descuidado: positive(obj(c.condition_surcharges).descuidado),
      muyDescuidado: positive(obj(c.condition_surcharges).muy_descuidado),
      waste: positive(obj(c.waste_removal).percentage),
      phytosanitary: nonNegative(c.phytosanitary),
      trunkFinish: nonNegative(c.trunk_finish),
      accessDifficulty: nonNegative(c.access_difficulty),
      minimum: positive(c.minimum_price),
    };
    for (const species of PALM_CANONICAL_SPECIES) {
      answers[speciesKey(species)] = selected.includes(species);
      for (const band of PALM_SPECIES_HEIGHT_BANDS[species]) {
        answers[fieldId('price', species, band)] = positive(obj(prices[species])[band]);
        answers[fieldId('min', species, band)] = perHourToMinutes(obj(yields[species])[band]);
      }
    }
    return answers;
  },
  toConfig: (a, previous) => {
    const prev = obj(previous) as Partial<PalmPricingConfig> & Record<string, unknown>;
    const perHour = isPerHour(a);
    const selected = selectedPalmSpecies(a);
    const heightPrices: Record<string, Record<string, number>> = { ...(obj(prev.height_prices) as Record<string, Record<string, number>>) };
    const yields: Record<string, Record<string, number>> = { ...(obj(prev.yield_units_per_hour) as Record<string, Record<string, number>>) };
    for (const species of selected) {
      const prevPrices = obj(heightPrices[species]);
      const bandsPrices: Record<string, number> = {};
      const bandsYields: Record<string, number> = {};
      for (const band of PALM_SPECIES_HEIGHT_BANDS[species]) {
        // Por hora, los precios por palmera no se usan, pero las alturas tienen que estar (el validador las
        // lee de aquí): se conserva lo que hubiera o 0.
        bandsPrices[band] = perHour ? Number(prevPrices[band] ?? 0) : n0(a[fieldId('price', species, band)]);
        const minutes = a[fieldId('min', species, band)];
        bandsYields[band] = typeof minutes === 'number' && minutes > 0 ? minutesToPerHour(minutes) : 0;
      }
      heightPrices[species] = bandsPrices;
      yields[species] = bandsYields;
    }
    const config: Record<string, unknown> = {
      ...prev,
      pricing_method: perHour ? 'per_hour' : 'per_quantity',
      precioPorHora: perHour ? n0(a.hourly) : prev.precioPorHora,
      selected_species: selected as PalmSpecies[],
      species_prices: prev.species_prices ?? {},
      height_prices: heightPrices,
      yield_units_per_hour: yields,
      condition_surcharges: { normal: 0, descuidado: n0(a.descuidado), muy_descuidado: n0(a.muyDescuidado) },
      waste_removal: { option: 'extra_percentage', percentage: n0(a.waste) },
      phytosanitary: n0(a.phytosanitary),
      trunk_finish: n0(a.trunkFinish),
      access_difficulty: n0(a.accessDifficulty),
      minimum_price: n0(a.minimum),
    };
    if (perHour && prev.hourly_rate !== undefined) config.hourly_rate = n0(a.hourly);
    return config;
  },
  isValid: (c) => isPalmConfigValid(c as unknown as PalmPricingConfig),
  examples: (config) => {
    const selected = (Array.isArray(config.selected_species) ? config.selected_species : []) as PalmCanonicalSpecies[];
    const species = selected.find((sp) => PALM_SPECIES_HEIGHT_BANDS[sp]);
    if (!species) return [];
    const [low, mid] = PALM_SPECIES_HEIGHT_BANDS[species];
    const name = PALM_COMMON_NAMES[species].toLowerCase();
    return [
      { label: `2 ${name}s ${palmBandLabel(low).toLowerCase()}`, bookingData: { palmGroups: [{ id: 'ej1', species, height: low, quantity: 2, state: 'normal' }], wasteRemoval: false } },
      { label: `1 ${name} ${palmBandLabel(mid).toLowerCase()}, descuidada`, bookingData: { palmGroups: [{ id: 'ej2', species, height: mid, quantity: 1, state: 'descuidado' }], wasteRemoval: false } },
      { label: `2 ${name}s ${palmBandLabel(low).toLowerCase()}, llevándote los restos`, bookingData: { palmGroups: [{ id: 'ej3', species, height: low, quantity: 2, state: 'normal' }], wasteRemoval: true } },
    ];
  },
};

export const UNIT_QUESTIONNAIRES: Partial<Record<string, ServiceQuestionnaire>> = {
  'Poda de árboles': tree,
  'Poda de palmeras': palm,
};
