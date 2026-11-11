// Valores sugeridos del cuestionario «Activa tu cuenta» (F0, 2026-11-11, decisión D1).
//
// Salen como BOTONES junto a cada pregunta («Lo habitual: 25 € · 28 € · 32 € · Otro»): el profesional toca
// uno o escribe el suyo. NUNCA se rellenan solos ni se guardan sin que los elija.
//
// De dónde salen: valores de partida tomados de la configuración de pruebas (`supabase/seed.sql`), con un
// valor por debajo y otro por encima. LOS FIJA EL PROPIETARIO: cambiarlos aquí cambia lo que se sugiere,
// no lo que ya guardó nadie.

/** % para recargos (estado, dificultad, retirada de restos, extras). */
export const PERCENT_CHIPS = [0, 10, 20, 30, 50] as const;

export const SUGGESTED = {
  lawn: {
    hourly: [25, 28, 32, 35],
    perM2: [0.15, 0.18, 0.22, 0.25],
    yieldM2PerHour: [100, 150, 200, 250],
    descuidado: [10, 20, 30],
    muyDescuidado: [30, 50, 70],
    waste: [0, 10, 15, 20],
    minimum: [30, 40, 45, 60],
  },
  hedge: {
    hourly: [25, 30, 35],
    perMeterLow: [2.5, 3.5, 4.5],
    perMeterMid: [4.5, 5.5, 7],
    perMeterHigh: [7, 8, 10],
    yieldLow: [15, 25, 35],
    yieldMid: [10, 15, 20],
    yieldHigh: [5, 8, 12],
    media: [10, 20, 30],
    alta: [30, 50, 70],
    waste: [0, 10, 15, 20],
    minimum: [35, 45, 50, 60],
  },
  shrub: {
    hourly: [25, 30, 35],
    perM2Small: [3.5, 4.5, 5.5],
    perM2Medium: [5.5, 6.5, 8],
    perM2Large: [8, 9, 11],
    yieldSmall: [8, 12, 16],
    yieldMedium: [6, 8, 10],
    yieldLarge: [3, 5, 7],
    descuidado: [10, 20, 30],
    muyDescuidado: [30, 50, 70],
    waste: [0, 10, 15, 20],
    minimum: [35, 45, 60],
  },
  weeding: {
    perM2: [0.25, 0.35, 0.45],
    yieldM2PerHour: [80, 120, 160],
    herbicidePerM2: [0.1, 0.15, 0.2],
    media: [10, 20, 30],
    alta: [30, 50, 70],
    waste: [0, 10, 20, 30],
    minimum: [45, 60, 75],
  },
  tree: {
    formacionSmall: [30, 35, 45],
    formacionMedium: [50, 60, 75],
    formacionLarge: [90, 110, 140],
    estructuralSmall: [40, 45, 55],
    estructuralMedium: [70, 80, 100],
    estructuralLarge: [130, 150, 190],
    /** Minutos por árbol (se convierten a árboles por hora). */
    minutesSmall: [20, 25, 30],
    minutesMedium: [40, 50, 60],
    minutesLarge: [75, 90, 120],
    difficulty: [10, 20, 30, 50],
    waste: [0, 10, 15, 20],
    minimum: [45, 60, 75],
  },
  palm: {
    /** Por palmera según lo alta que sea (la primera altura de cada especie es la más baja). */
    perPalmLow: [35, 45, 55],
    perPalmMid: [80, 90, 100],
    perPalmHigh: [140, 150, 180],
    perPalmTop: [190, 200, 240],
    minutesLow: [30, 40, 45],
    minutesMid: [60, 75, 90],
    minutesHigh: [100, 120, 150],
    minutesTop: [150, 170, 200],
    descuidado: [10, 20, 30],
    muyDescuidado: [30, 50, 70],
    waste: [0, 10, 15, 20],
    phytosanitary: [0, 10, 15, 20],
    trunkFinish: [0, 10, 20, 30],
    accessDifficulty: [0, 10, 20, 30],
    minimum: [45, 60, 75],
  },
} as const;
