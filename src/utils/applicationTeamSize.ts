// «¿Cuántas personas trabajarán desde tu perfil?» del alta de jardinero (2026-11-09).
//
// GarSer es para profesionales por cuenta propia y para empresas. El dato que ayuda a decidir una
// solicitud es con cuánta gente se va a trabajar: un autónomo solo (1) no es lo mismo que una empresa
// con cuadrilla. Se guarda como un entero en `gardener_applications.estimated_team_size`, CONTANDO al
// propio solicitante, y es solo una estimación: no crea equipo (eso lo decide `provider_kind`, que
// pasa a equipo al aceptar el primer compañero).
//
// El límite (1-200) es el mismo que la comprobación de la base de datos
// (gardener_applications_estimated_team_size_range) y el del envío (submit_gardener_application).

export type TeamChoice = 'solo' | 'team';

export const MIN_TEAM_SIZE = 1;
/** Mínimo cuando se elige «con equipo»: uno mismo y, al menos, otra persona. */
export const MIN_TEAM_SIZE_WITH_TEAM = 2;
export const MAX_TEAM_SIZE = 200;

/** El entero que se guarda, o null si todavía no hay una respuesta válida (nada elegido, o «con equipo» sin número). */
export function estimatedTeamSize(choice: TeamChoice | null, input: string): number | null {
  if (choice === 'solo') return MIN_TEAM_SIZE;
  if (choice !== 'team') return null;
  const text = input.trim();
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= MIN_TEAM_SIZE_WITH_TEAM && n <= MAX_TEAM_SIZE ? n : null;
}

/** Lo contrario, para volver a pintar un borrador guardado. Un valor fuera de rango no restaura nada. */
export function teamStateFromSize(size: number | null | undefined): { choice: TeamChoice | null; input: string } {
  if (typeof size !== 'number' || !Number.isInteger(size)) return { choice: null, input: '' };
  if (size === MIN_TEAM_SIZE) return { choice: 'solo', input: '' };
  if (size >= MIN_TEAM_SIZE_WITH_TEAM && size <= MAX_TEAM_SIZE) return { choice: 'team', input: String(size) };
  return { choice: null, input: '' };
}

/** Lo que falta en esta pregunta, para el aviso junto al botón; '' si ya está respondida. */
export function teamSizeHint(choice: TeamChoice | null, input: string): string {
  if (estimatedTeamSize(choice, input) !== null) return '';
  if (choice === 'team') {
    return `Indica cuántas personas sois en total, contándote a ti (de ${MIN_TEAM_SIZE_WITH_TEAM} a ${MAX_TEAM_SIZE}).`;
  }
  return 'Indica si trabajas solo o con equipo.';
}

/** Cómo lo lee quien revisa la solicitud (panel de administración). */
export function describeTeamSize(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isInteger(size) || size < MIN_TEAM_SIZE) return 'Sin indicar (solicitud anterior)';
  if (size === MIN_TEAM_SIZE) return 'Solo, sin equipo (1 persona)';
  return `Con equipo (${size} personas contando al solicitante)`;
}
