// Los 7 servicios de GarSer tal como los ve el cuestionario «Activa tu cuenta» (2026-11-11).
//
// El nombre es la clave de todo (tabla `services`, configuradores, motor de precios). El orden es el de
// la pantalla y el de los sub-pasos 2.1, 2.2… del cuestionario.

export type ActivationServiceName =
  | 'Corte de césped'
  | 'Poda de setos'
  | 'Poda de plantas y arbustos'
  | 'Poda de árboles'
  | 'Poda de palmeras'
  | 'Desbroce de malas hierbas'
  | 'Servicios fitosanitarios';

export interface ActivationServiceInfo {
  name: ActivationServiceName;
  /** Corto, para los sub-pasos y el progreso («Césped ✓ · Setos»). */
  short: string;
  /** Una línea en la tarjeta de elegir servicios. */
  blurb: string;
  /** Pide carnet de aplicador para poder ofrecerse. */
  needsLicense?: boolean;
}

export const ACTIVATION_SERVICES: readonly ActivationServiceInfo[] = [
  { name: 'Corte de césped', short: 'Césped', blurb: 'Cortar y perfilar césped.' },
  { name: 'Poda de setos', short: 'Setos', blurb: 'Recortar setos por metro o por hora.' },
  { name: 'Poda de plantas y arbustos', short: 'Arbustos', blurb: 'Podar plantas y arbustos por tamaño.' },
  { name: 'Poda de árboles', short: 'Árboles', blurb: 'Poda de formación y estructural, por árbol.' },
  { name: 'Poda de palmeras', short: 'Palmeras', blurb: 'Limpieza de palmeras por especie y altura.' },
  { name: 'Desbroce de malas hierbas', short: 'Desbroce', blurb: 'Desbrozar terrenos y quitar malas hierbas.' },
  {
    name: 'Servicios fitosanitarios',
    short: 'Fitosanitarios',
    blurb: 'Tratamientos contra plagas y enfermedades.',
    needsLicense: true,
  },
];

const normalize = (s: string) =>
  (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * El nombre canónico de un servicio escrito de cualquier forma («corte de cesped», «Fumigación»…), o null
 * si no es uno de los 7. Misma regla que «Mi perfil → Servicios».
 */
export function toActivationServiceName(name: string | null | undefined): ActivationServiceName | null {
  const n = normalize(name || '');
  if (!n) return null;
  if (n.includes('fitosanit') || n.includes('fumig')) return 'Servicios fitosanitarios';
  return ACTIVATION_SERVICES.find((s) => normalize(s.name) === n)?.name ?? null;
}

/** Ordena y quita repetidos y desconocidos, en el orden de la pantalla. */
export function sortActivationServices(names: Iterable<string | null | undefined>): ActivationServiceName[] {
  const wanted = new Set<ActivationServiceName>();
  for (const raw of names) {
    const name = toActivationServiceName(raw);
    if (name) wanted.add(name);
  }
  return ACTIVATION_SERVICES.map((s) => s.name).filter((name) => wanted.has(name));
}

export function serviceInfo(name: ActivationServiceName): ActivationServiceInfo {
  return ACTIVATION_SERVICES.find((s) => s.name === name)!;
}
