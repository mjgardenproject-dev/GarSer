import { supabase } from '../lib/supabase';

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
    const uniqueDates = [...new Set(data?.map(item => item.date) || [])];
    return uniqueDates;
  } catch (error) {
    console.error('Error in getAvailableDates:', error);
    throw error;
  }
}

export async function setDefaultAvailability(gardenerId: string, date: string) {
  try {
    // Set default availability from 8 AM to 6 PM (8-17 hour blocks)
    const defaultHours = Array.from({ length: 10 }, (_, i) => i + 8); // 8, 9, 10, ..., 17
    
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
