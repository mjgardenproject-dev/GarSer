// El perfil público enseña los servicios de `gardener_profiles.services`. Esa columna mezcla dos
// formatos: el alta guarda nombres («Corte de césped») y la configuración de precios guarda los
// identificadores de `services`. Sin traducirlos, el cliente veía identificadores internos
// (visto en la fase D, 2026-10-09). Aquí se pasan a nombres, sin repetir y sin los desconocidos.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isServiceId = (value: string) => UUID.test(String(value || '').trim());

export function serviceLabels(raw: string[] | null | undefined, nameById: Record<string, string>): string[] {
  const labels: string[] = [];
  for (const item of raw || []) {
    const value = String(item || '').trim();
    if (!value) continue;
    const label = isServiceId(value) ? nameById[value] : value;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}
