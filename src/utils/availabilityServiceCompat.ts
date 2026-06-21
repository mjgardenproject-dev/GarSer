import { supabase } from '../lib/supabase';
import { addDays, format } from 'date-fns';

// Compatibility layer to work with the existing 'availability' table
// while the code expects 'availability_blocks' structure

interface AvailabilityBlock {
  id: string;
  gardener_id: string;
  date: string;
  hour_block: number;
  is_available: boolean;
  created_at: string;
  updated_at?: string;
}

interface AvailabilityRecord {
  id: string;
  gardener_id: string;
  date: string;
  start_time: string;
  end_time: string;
  is_available: boolean;
  created_at: string;
}

// Convert hour block (0-23) to time string (HH:00:00)
function hourBlockToTime(hourBlock: number): string {
  return `${hourBlock.toString().padStart(2, '0')}:00:00`;
}

// Convert time string (HH:MM:SS) to hour block (0-23)
function timeToHourBlock(timeString: string): number {
  const hour = parseInt(timeString.split(':')[0]);
  return hour;
}

// Convert availability record to availability block format
function convertToBlock(record: AvailabilityRecord): AvailabilityBlock {
  return {
    id: record.id,
    gardener_id: record.gardener_id,
    date: record.date,
    hour_block: timeToHourBlock(record.start_time),
    is_available: record.is_available,
    created_at: record.created_at,
    updated_at: record.created_at
  };
}

export async function getGardenerAvailability(gardenerId: string, date: string) {
  try {
    console.log(`Fetching availability for gardener ${gardenerId} on ${date}`);
    
    const { data, error } = await supabase
      .from('availability')
      .select('*')
      .eq('gardener_id', gardenerId)
      .eq('date', date)
      .order('start_time', { ascending: true });

    if (error) {
      console.error('Error fetching gardener availability:', error);
      throw error;
    }

    // Convert to block format
    const blocks = data?.map(convertToBlock) || [];
    console.log(`Found ${blocks.length} availability blocks for ${date}`);
    
    return blocks;
  } catch (error) {
    console.error('Error in getGardenerAvailability:', error);
    throw error;
  }
}

export async function setGardenerAvailability(gardenerId: string, date: string, hourBlocks: number[]) {
  try {
    console.log(`Setting availability for gardener ${gardenerId} on ${date}:`, hourBlocks);

    // Delete existing availability for this date
    const { error: deleteError } = await supabase
      .from('availability')
      .delete()
      .eq('gardener_id', gardenerId)
      .eq('date', date);

    if (deleteError) {
      console.error('Error deleting existing availability:', deleteError);
      throw deleteError;
    }

    // Insert new availability blocks
    if (hourBlocks.length > 0) {
      const availabilityRecords = hourBlocks.map(hourBlock => ({
        gardener_id: gardenerId,
        date,
        start_time: hourBlockToTime(hourBlock),
        end_time: hourBlockToTime(hourBlock + 1), // End time is next hour
        is_available: true
      }));

      const { error: insertError } = await supabase
        .from('availability')
        .insert(availabilityRecords);

      if (insertError) {
        console.error('Error inserting availability:', insertError);
        throw insertError;
      }
    }

    console.log(`Successfully set availability for ${hourBlocks.length} hour blocks`);
    return { success: true };
  } catch (error) {
    console.error('Error in setGardenerAvailability:', error);
    throw error;
  }
}

export async function getAvailabilityForDate(gardenerId: string, date: string) {
  return getGardenerAvailability(gardenerId, date);
}

export async function isGardenerAvailable(gardenerId: string, date: string, hourBlock: number) {
  try {
    const startTime = hourBlockToTime(hourBlock);
    
    const { data, error } = await supabase
      .from('availability')
      .select('is_available')
      .eq('gardener_id', gardenerId)
      .eq('date', date)
      .eq('start_time', startTime)
      .single();

    if (error) {
      console.error('Error checking availability:', error);
      return false;
    }

    return data?.is_available || false;
  } catch (error) {
    console.error('Error in isGardenerAvailable:', error);
    return false;
  }
}

export async function blockTimeSlots(gardenerId: string, date: string, hourBlocks: number[]) {
  try {
    for (const hourBlock of hourBlocks) {
      const startTime = hourBlockToTime(hourBlock);
      
      const { error } = await supabase
        .from('availability')
        .update({ is_available: false })
        .eq('gardener_id', gardenerId)
        .eq('date', date)
        .eq('start_time', startTime);

      if (error) {
        console.error(`Error blocking hour ${hourBlock}:`, error);
        throw error;
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error in blockTimeSlots:', error);
    throw error;
  }
}

export async function releaseTimeSlots(gardenerId: string, date: string, hourBlocks: number[]) {
  try {
    for (const hourBlock of hourBlocks) {
      const startTime = hourBlockToTime(hourBlock);
      
      const { error } = await supabase
        .from('availability')
        .update({ is_available: true })
        .eq('gardener_id', gardenerId)
        .eq('date', date)
        .eq('start_time', startTime);

      if (error) {
        console.error(`Error releasing hour ${hourBlock}:`, error);
        throw error;
      }
    }

    return { success: true };
  } catch (error) {
    console.error('Error in releaseTimeSlots:', error);
    throw error;
  }
}

export async function getAvailableDates(gardenerId: string, startDate: string, endDate: string) {
  try {
    const { data, error } = await supabase
      .from('availability')
      .select('date')
      .eq('gardener_id', gardenerId)
      .eq('is_available', true)
      .gte('date', startDate)
      .lte('date', endDate);

    if (error) {
      console.error('Error fetching available dates:', error);
      throw error;
    }

    // Get unique dates
    const uniqueDates = [...new Set(data?.map((item: { date: string }) => item.date) || [])];
    return uniqueDates;
  } catch (error) {
    console.error('Error in getAvailableDates:', error);
    throw error;
  }
}

export async function setDefaultAvailability(gardenerId: string, date: string) {
  try {
    // Set default availability from 7 AM to 8 PM (block start hours 7-19)
    const defaultHours = Array.from({ length: 13 }, (_, i) => i + 7); // 7, 8, ..., 19

    await setGardenerAvailability(gardenerId, date, defaultHours);
    
    return { success: true };
  } catch (error) {
    console.error('Error in setDefaultAvailability:', error);
    throw error;
  }
}

export async function getAvailabilityRange(gardenerId: string, startDate: string, endDate: string) {
  try {
    const { data, error } = await supabase
      .from('availability')
      .select('*')
      .eq('gardener_id', gardenerId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });
    if (error) {
      throw error;
    }
    const blocks = (data || []).map(convertToBlock);
    return blocks;
  } catch (error) {
    console.error('Error in getAvailabilityRange:', error);
    throw error;
  }
}

export async function applyRecurringSchedule(
  gardenerId: string,
  scheduleMatrix: Record<number, Set<number>>,
  weeksToMaintain: number
) {
  try {
    console.log(`Applying recurring schedule for gardener ${gardenerId} for ${weeksToMaintain} weeks`);

    const startDate = new Date();
    const endDate = addDays(startDate, weeksToMaintain * 7);
    const startStr = format(startDate, 'yyyy-MM-dd');
    const endStr = format(endDate, 'yyyy-MM-dd');

    // Fetch confirmed bookings in the range to avoid overwriting them.
    const { data: bookings } = await supabase
      .from('bookings')
      .select('date, start_time, duration_hours')
      .eq('gardener_id', gardenerId)
      .in('status', ['confirmed', 'in_progress'])
      .gte('date', startStr)
      .lte('date', endStr);

    // Build a map of date → Set<hour> for all booked slots.
    const bookedByDate: Record<string, Set<number>> = {};
    for (const booking of (bookings || [])) {
      const hour = parseInt(String(booking.start_time || '08:00').split(':')[0], 10);
      const duration = Number(booking.duration_hours || 1);
      const dateKey = String(booking.date).slice(0, 10);
      if (!bookedByDate[dateKey]) bookedByDate[dateKey] = new Set();
      for (let h = hour; h < hour + duration; h++) {
        bookedByDate[dateKey].add(h);
      }
    }

    const datesToProcess: Date[] = [];
    let currentDate = startDate;
    while (currentDate <= endDate) {
      datesToProcess.push(new Date(currentDate));
      currentDate = addDays(currentDate, 1);
    }

    // Process in chunks to avoid overwhelming the server/connection.
    const CHUNK_SIZE = 7;
    for (let i = 0; i < datesToProcess.length; i += CHUNK_SIZE) {
      const chunk = datesToProcess.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map(async (date) => {
        const dayOfWeek = date.getDay(); // 0 (Sunday) to 6 (Saturday)
        const hours = scheduleMatrix[dayOfWeek];
        const dateStr = format(date, 'yyyy-MM-dd');
        const hoursList = hours ? Array.from(hours) : [];
        await setGardenerAvailability(gardenerId, dateStr, hoursList);

        // Re-block any confirmed bookings that fall on this day so the
        // DELETE+INSERT in setGardenerAvailability doesn't expose them.
        const bookedHours = Array.from(bookedByDate[dateStr] || []);
        if (bookedHours.length > 0) {
          await blockTimeSlots(gardenerId, dateStr, bookedHours);
        }
      }));
    }

    console.log('Successfully applied recurring schedule');
    return { success: true };
  } catch (error) {
    console.error('Error in applyRecurringSchedule:', error);
    throw error;
  }
}
