// Fachada del almacén de disponibilidad del jardinero (tabla `availability`).
//
// Solo cubre la CONFIGURACIÓN del calendario del jardinero. La disponibilidad de
// cara al cliente y el bloqueo/liberación de slots son server-side: Edge Function
// `booking-authority` (validStartHours/earliestSlot) + guardas SQL de
// `booking-payment` (holds y is_available=false al confirmar).
// No añadir aquí lógica de reserva.
import * as compatService from './availabilityServiceCompat';
import { AvailabilityBlock, TimeBlock } from '../types';
import { WORK_DAY_START_HOUR, LATEST_BLOCK_START_HOUR } from './availabilityWindow';

// Bloques de 1 hora del día laboral: inicios de 7:00 a 19:00 (el último cubre 19:00–20:00)
export function generateDailyTimeBlocks(): TimeBlock[] {
  const blocks: TimeBlock[] = [];

  for (let hour = WORK_DAY_START_HOUR; hour <= LATEST_BLOCK_START_HOUR; hour++) {
    blocks.push({
      hour,
      label: `${hour.toString().padStart(2, '0')}:00`,
      available: false
    });
  }

  return blocks;
}

// Disponibilidad de un jardinero para una fecha concreta
export async function getGardenerAvailability(gardenerId: string, date: string): Promise<AvailabilityBlock[]> {
  return compatService.getGardenerAvailability(gardenerId, date);
}

// Disponibilidad de un jardinero para un rango de fechas en una sola query,
// agrupada por fecha (yyyy-MM-dd). Evita el N+1 de pedir día a día.
export async function getGardenerAvailabilityByDate(
  gardenerId: string,
  startDate: string,
  endDate: string
): Promise<Record<string, AvailabilityBlock[]>> {
  const blocks = await compatService.getAvailabilityRange(gardenerId, startDate, endDate);
  const byDate: Record<string, AvailabilityBlock[]> = {};
  blocks.forEach((block) => {
    (byDate[block.date] ||= []).push(block);
  });
  return byDate;
}

// Establecer la disponibilidad de una fecha (reemplaza los bloques del día)
export async function setGardenerAvailability(gardenerId: string, date: string, hourBlocks: number[]): Promise<{ success: boolean }> {
  return compatService.setGardenerAvailability(gardenerId, date, hourBlocks);
}

// Aplicar horario recurrente (fallback client-side del RPC generate_recurring_slots)
export async function applyRecurringSchedule(
  gardenerId: string,
  scheduleMatrix: Record<number, Set<number>>,
  weeksToMaintain: number
) {
  return compatService.applyRecurringSchedule(gardenerId, scheduleMatrix, weeksToMaintain);
}
