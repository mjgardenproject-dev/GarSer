import { supabase } from '../lib/supabase';
import { Booking, TimeBlock } from '../types';
import { format, parseISO, addMinutes, isSameDay } from 'date-fns';

export class BufferService {
  // Verificar si se necesita aplicar buffer entre dos reservas
  static needsBuffer(
    existingBooking: Booking, 
    newStartHour: number, 
    newClientId: string,
    date: string
  ): boolean {
    // No aplicar buffer si es el mismo cliente
    if (existingBooking.client_id === newClientId) {
      return false;
    }

    // No aplicar buffer si no es el mismo día
    if (existingBooking.date !== date) {
      return false;
    }

    const existingStartHour = parseInt(existingBooking.start_time.split(':')[0]);
    const existingEndHour = existingStartHour + existingBooking.duration_hours;

    // Verificar si la nueva reserva está inmediatamente después de la existente
    return existingEndHour === newStartHour;
  }

  // Obtener reservas existentes de un jardinero para una fecha específica
  static async getGardenerBookingsForDate(gardenerId: string, date: string): Promise<Booking[]> {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('*')
        .eq('gardener_id', gardenerId)
        .eq('date', date)
        .in('status', ['confirmed', 'in_progress'])
        .order('start_time', { ascending: true });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('Error fetching gardener bookings:', error);
      return [];
    }
  }

  // Aplicar reglas de buffer a los bloques de tiempo disponibles
  static async applyBufferRules(
    gardenerId: string,
    date: string,
    clientId: string,
    availableBlocks: TimeBlock[]
  ): Promise<TimeBlock[]> {
    try {
      const existingBookings = await this.getGardenerBookingsForDate(gardenerId, date);
      
      if (existingBookings.length === 0) {
        return availableBlocks;
      }

      const blocksWithBuffer = availableBlocks.map(block => {
        let hasBuffer = false;

        // Verificar si este bloque necesita buffer
        for (const booking of existingBookings) {
          if (this.needsBuffer(booking, block.hour, clientId, date)) {
            hasBuffer = true;
            break;
          }
        }

        return {
          ...block,
          available: block.available && !hasBuffer,
          hasBuffer
        };
      });

      return blocksWithBuffer;
    } catch (error) {
      console.error('Error applying buffer rules:', error);
      return availableBlocks;
    }
  }

  // Verificar si una secuencia de bloques puede ser reservada considerando buffers
  static async canBookSequence(
    gardenerId: string,
    date: string,
    startHour: number,
    durationHours: number,
    clientId: string
  ): Promise<{ canBook: boolean; reason?: string }> {
    try {
      const existingBookings = await this.getGardenerBookingsForDate(gardenerId, date);
      
      // Verificar cada hora en la secuencia
      for (let i = 0; i < durationHours; i++) {
        const currentHour = startHour + i;
        
        // Verificar si hay conflicto directo
        const hasDirectConflict = existingBookings.some(booking => {
          const bookingStartHour = parseInt(booking.start_time.split(':')[0]);
          const bookingEndHour = bookingStartHour + booking.duration_hours;
          return currentHour >= bookingStartHour && currentHour < bookingEndHour;
        });

        if (hasDirectConflict) {
          return { 
            canBook: false, 
            reason: `Conflicto directo en la hora ${currentHour}:00` 
          };
        }

        // Verificar buffer solo para el primer bloque
        if (i === 0) {
          const needsBufferCheck = existingBookings.some(booking => 
            this.needsBuffer(booking, currentHour, clientId, date)
          );

          if (needsBufferCheck) {
            return { 
              canBook: false, 
              reason: 'Se requiere un intervalo de 30 minutos entre clientes diferentes' 
            };
          }
        }
      }

      return { canBook: true };
    } catch (error) {
      console.error('Error checking booking sequence:', error);
      return { canBook: false, reason: 'Error al verificar disponibilidad' };
    }
  }

  // Obtener bloques disponibles considerando buffers para múltiples jardineros
  static async getAvailableBlocksWithBuffer(
    gardenerIds: string[],
    date: string,
    clientId: string
  ): Promise<Map<string, TimeBlock[]>> {
    try {
      const result = new Map<string, TimeBlock[]>();

      for (const gardenerId of gardenerIds) {
        // Use compatibility service to get availability
        const availabilityData = await import('./availabilityServiceCompat').then(service => 
          service.getGardenerAvailability(gardenerId, date)
        );
        
        const error = null;

        if (error) {
          console.error('Error fetching availability:', error);
          continue;
        }

        // Crear bloques de tiempo base
        const baseBlocks: TimeBlock[] = [];
        for (let hour = 8; hour <= 19; hour++) {
          const isAvailable = availabilityData?.some(block => block.hour_block === hour) || false;
          baseBlocks.push({
            hour,
            label: `${hour.toString().padStart(2, '0')}:00 - ${(hour + 1).toString().padStart(2, '0')}:00`,
            available: isAvailable,
            selected: false
          });
        }

        // Aplicar reglas de buffer
        const blocksWithBuffer = await this.applyBufferRules(
          gardenerId, 
          date, 
          clientId, 
          baseBlocks
        );

        result.set(gardenerId, blocksWithBuffer);
      }

      return result;
    } catch (error) {
      console.error('Error getting available blocks with buffer:', error);
      return new Map();
    }
  }

  // Calcular el próximo slot disponible después de aplicar buffer
  static calculateNextAvailableSlot(
    existingBookings: Booking[],
    requestedStartHour: number,
    clientId: string
  ): number | null {
    // Ordenar reservas por hora de inicio
    const sortedBookings = existingBookings.sort((a, b) => {
      const aHour = parseInt(a.start_time.split(':')[0]);
      const bHour = parseInt(b.start_time.split(':')[0]);
      return aHour - bHour;
    });

    // Buscar el próximo slot disponible
    for (let hour = requestedStartHour; hour <= 19; hour++) {
      const hasConflict = sortedBookings.some(booking => {
        const bookingStartHour = parseInt(booking.start_time.split(':')[0]);
        const bookingEndHour = bookingStartHour + booking.duration_hours;
        
        // Verificar conflicto directo
        if (hour >= bookingStartHour && hour < bookingEndHour) {
          return true;
        }

        // Verificar buffer si es cliente diferente
        if (booking.client_id !== clientId && bookingEndHour === hour) {
          return true;
        }

        return false;
      });

      if (!hasConflict) {
        return hour;
      }
    }

    return null; // No hay slots disponibles
  }

  // Sugerir horarios alternativos considerando buffers
  static async suggestAlternativeSlots(
    gardenerId: string,
    date: string,
    requestedStartHour: number,
    durationHours: number,
    clientId: string
  ): Promise<number[]> {
    try {
      const existingBookings = await this.getGardenerBookingsForDate(gardenerId, date);
      const suggestions: number[] = [];

      // Intentar encontrar 3 alternativas
      let currentHour = requestedStartHour;
      let attempts = 0;
      const maxAttempts = 12; // Buscar hasta 12 horas después

      while (suggestions.length < 3 && attempts < maxAttempts) {
        const nextSlot = this.calculateNextAvailableSlot(existingBookings, currentHour, clientId);
        
        if (nextSlot !== null && nextSlot + durationHours <= 20) {
          // Verificar que toda la secuencia esté disponible
          const canBook = await this.canBookSequence(
            gardenerId, 
            date, 
            nextSlot, 
            durationHours, 
            clientId
          );

          if (canBook.canBook) {
            suggestions.push(nextSlot);
          }
        }

        currentHour = nextSlot ? nextSlot + 1 : currentHour + 1;
        attempts++;
      }

      return suggestions;
    } catch (error) {
      console.error('Error suggesting alternative slots:', error);
      return [];
    }
  }
}

// Exportaciones individuales para facilitar la importación
export const needsBuffer = BufferService.needsBuffer;
export const getGardenerBookingsForDate = BufferService.getGardenerBookingsForDate;
export const applyBufferRules = BufferService.applyBufferRules;
export const canBookSequence = BufferService.canBookSequence;
export const getAvailableBlocksWithBuffer = BufferService.getAvailableBlocksWithBuffer;
export const getNextAvailableSlot = BufferService.getNextAvailableSlot;
export const suggestAlternativeSlots = BufferService.suggestAlternativeSlots;