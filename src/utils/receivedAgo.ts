// «Hace cuánto llegó» una solicitud (R-06d). Antes se redondeaba hacia ARRIBA (Math.ceil): un
// segundo después de llegar ya decía «Hace 1 hora» y «Recién recibida» no salía nunca. Siempre
// hacia abajo, y en minutos por debajo de una hora.

export function receivedAgo(createdAt: string | Date, now: Date = new Date()): string {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const ms = now.getTime() - created.getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  if (minutes < 1) return 'Recién recibida';
  if (minutes < 60) return `Hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'Hace 1 hora' : `Hace ${hours} horas`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'Hace 1 día' : `Hace ${days} días`;
}
