// Temporary compatibility import while availability_blocks table is being created
import * as compatService from './availabilityServiceCompat';
import { AvailabilityBlock, TimeBlock } from '../types';
import { format, addDays, startOfDay, parseISO } from 'date-fns';

// Generar bloques de tiempo para un día (8:00 AM a 8:00 PM)
export function generateDailyTimeBlocks(): TimeBlock[] {
  const blocks: TimeBlock[] = [];
  
  // Solo generar bloques de 8:00 a 19:00 (8:00-9:00 hasta 19:00-20:00)
  for (let hour = 8; hour <= 19; hour++) {
    blocks.push({
      hour,
      label: `${hour.toString().padStart(2, '0')}:00`,
      available: false
    });
  }
  
  return blocks;
}

// Obtener disponibilidad de un jardinero para una fecha específica
export async function getGardenerAvailability(gardenerId: string, date: string): Promise<AvailabilityBlock[]> {
  return compatService.getGardenerAvailability(gardenerId, date);
}

// Establecer disponibilidad de un jardinero para una fecha específica
export async function setGardenerAvailability(gardenerId: string, date: string, hourBlocks: number[]): Promise<{ success: boolean }> {
  return compatService.setGardenerAvailability(gardenerId, date, hourBlocks);
}

// Obtener disponibilidad para una fecha específica
export async function getAvailabilityForDate(gardenerId: string, date: string): Promise<AvailabilityBlock[]> {
  return compatService.getAvailabilityForDate(gardenerId, date);
}

// Verificar si un jardinero está disponible para un bloque horario específico
export async function isGardenerAvailable(gardenerId: string, date: string, hourBlock: number): Promise<boolean> {
  return compatService.isGardenerAvailable(gardenerId, date, hourBlock);
}

// Bloquear bloques de tiempo después de una reserva confirmada
export async function blockTimeSlots(gardenerId: string, date: string, hourBlocks: number[]): Promise<{ success: boolean }> {
  return compatService.blockTimeSlots(gardenerId, date, hourBlocks);
}

// Liberar bloques de tiempo (por ejemplo, si se cancela una reserva)
export async function releaseTimeSlots(gardenerId: string, date: string, hourBlocks: number[]): Promise<{ success: boolean }> {
  return compatService.releaseTimeSlots(gardenerId, date, hourBlocks);
}

// Obtener fechas disponibles para un jardinero
export async function getAvailableDates(gardenerId: string, startDate: string, endDate: string): Promise<string[]> {
  return compatService.getAvailableDates(gardenerId, startDate, endDate);
}

// Configurar disponibilidad por defecto para un jardinero
export async function setDefaultAvailability(gardenerId: string, date: string): Promise<{ success: boolean }> {
  return compatService.setDefaultAvailability(gardenerId, date);
}

// Clase de servicio para compatibilidad con código existente
export class AvailabilityService {
  static generateDailyTimeBlocks = generateDailyTimeBlocks;
  static getGardenerAvailability = getGardenerAvailability;
  static setGardenerAvailability = setGardenerAvailability;
  static getAvailabilityForDate = getAvailabilityForDate;
  static isGardenerAvailable = isGardenerAvailable;
  static blockTimeSlots = blockTimeSlots;
  static releaseTimeSlots = releaseTimeSlots;
  static getAvailableDates = getAvailableDates;
  static setDefaultAvailability = setDefaultAvailability;
}