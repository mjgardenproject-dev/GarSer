import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, DollarSign } from 'lucide-react';
import { format, addDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { TimeBlock, AvailabilityBlock } from '../../types';
import { generateDailyTimeBlocks } from '../../utils/availabilityService';
import { getAvailableBlocksWithBuffer } from '../../utils/bufferService';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface TimeBlockSelectorProps {
  selectedDate: Date;
  clientAddress: string;
  serviceId: string;
  selectedBlocks: TimeBlock[];
  onBlocksChange: (blocks: TimeBlock[]) => void;
  onDateChange: (date: Date) => void;
}

const TimeBlockSelector: React.FC<TimeBlockSelectorProps> = ({
  selectedDate,
  clientAddress,
  serviceId,
  selectedBlocks,
  onBlocksChange,
  onDateChange
}) => {
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [availableBlocks, setAvailableBlocks] = useState<AvailabilityBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [availableDates, setAvailableDates] = useState<Date[]>([]);
  const [availableGardeners, setAvailableGardeners] = useState<string[]>([]);

  const timeBlocks = generateDailyTimeBlocks();

  useEffect(() => {
    fetchAvailableGardeners();
    generateAvailableDates();
  }, [serviceId, clientAddress]);

  useEffect(() => {
    fetchAvailableBlocks();
  }, [selectedDate, availableGardeners]);

  useEffect(() => {
    // Sync selectedBlockIds with selectedBlocks prop
    const blockIds = selectedBlocks.map(block => block.id);
    setSelectedBlockIds(blockIds);
  }, [selectedBlocks]);

  const fetchAvailableGardeners = async () => {
    if (!serviceId || !clientAddress) return;

    try {
      // Get gardeners who offer this service
      const { data: gardeners, error } = await supabase
        .from('gardener_profiles')
        .select('user_id')
        .contains('services', [serviceId])
        .eq('is_available', true);

      if (error) throw error;

      const gardenerIds = gardeners?.map(g => g.user_id) || [];
      setAvailableGardeners(gardenerIds);
    } catch (error) {
      console.error('Error fetching available gardeners:', error);
      setAvailableGardeners([]);
    }
  };

  const fetchAvailableBlocks = async () => {
    if (!clientAddress || availableGardeners.length === 0) return;

    setLoading(true);
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const blocksMap = await getAvailableBlocksWithBuffer(
        availableGardeners,
        dateStr,
        'client-temp-id' // Temporary client ID
      );
      
      // Combine blocks from all gardeners
      const allBlocks: AvailabilityBlock[] = [];
      blocksMap.forEach((blocks, gardenerId) => {
        blocks.forEach(block => {
          allBlocks.push({
            id: `${gardenerId}-${block.hour}`,
            gardener_id: gardenerId,
            date: dateStr,
            hour_block: block.hour,
            is_available: block.available,
            created_at: new Date().toISOString()
          });
        });
      });
      
      setAvailableBlocks(allBlocks);
    } catch (error) {
      console.error('Error fetching available blocks:', error);
      toast.error('Error al cargar los horarios disponibles');
    } finally {
      setLoading(false);
    }
  };

  const generateAvailableDates = () => {
    // Generar próximos 30 días como fechas disponibles
    const dates: Date[] = [];
    for (let i = 0; i < 30; i++) {
      dates.push(addDays(startOfDay(new Date()), i));
    }
    setAvailableDates(dates);
  };

  const isBlockAvailable = (blockId: string): boolean => {
    const hour = parseInt(blockId.replace('time-', ''));
    return availableBlocks.some(block => block.hour === hour && block.is_available);
  };

  const isBlockSelected = (blockId: string): boolean => {
    return selectedBlockIds.includes(blockId);
  };

  const toggleBlockSelection = (blockId: string) => {
    if (!isBlockAvailable(blockId)) {
      toast.error('Este horario no está disponible');
      return;
    }

    setSelectedBlockIds(prev => {
      const newSelection = prev.includes(blockId)
        ? prev.filter(id => id !== blockId)
        : [...prev, blockId].sort();
      
      // Obtener bloques seleccionados con detalles
      const selectedTimeBlocks = newSelection.map(id => {
        const hour = parseInt(id.replace('time-', ''));
        const timeBlock = timeBlocks.find(tb => tb.hour === hour);
        if (timeBlock) {
          return {
            ...timeBlock,
            id: id,
            start_time: `${hour.toString().padStart(2, '0')}:00`,
            end_time: `${(hour + 1).toString().padStart(2, '0')}:00`
          };
        }
        return null;
      }).filter(Boolean);
      
      // Notificar al componente padre
      onBlocksChange(selectedTimeBlocks);
      
      return newSelection;
    });
  };

  const getBlockStatus = (blockId: string) => {
    if (isBlockSelected(blockId)) {
      return 'selected';
    }
    if (isBlockAvailable(blockId)) {
      return 'available';
    }
    return 'unavailable';
  };

  const getBlockStyles = (status: string) => {
    switch (status) {
      case 'selected':
        return 'bg-green-500 border-green-600 text-white shadow-lg transform scale-105';
      case 'available':
        return 'bg-white border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400';
      case 'unavailable':
        return 'bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed';
      default:
        return 'bg-gray-100 border-gray-300 text-gray-400';
    }
  };

  const clearSelection = () => {
    setSelectedBlockIds([]);
    onBlocksChange([]);
  };

  const totalHours = selectedBlocks.length;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-900 flex items-center">
          <Clock className="w-5 h-5 mr-2" />
          Seleccionar Horarios
        </h3>
        {selectedBlockIds.length > 0 && (
          <button
            onClick={clearSelection}
            className="text-sm text-red-600 hover:text-red-800 underline"
          >
            Limpiar selección
          </button>
        )}
      </div>

      {/* Date Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          <Calendar className="w-4 h-4 inline mr-1" />
          Fecha del servicio
        </label>
        <div className="grid grid-cols-7 gap-2">
          {availableDates.slice(0, 14).map((date) => {
            const isSelected = format(date, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
            const isToday = format(date, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
            
            return (
              <button
                key={format(date, 'yyyy-MM-dd')}
                onClick={() => onDateChange(date)}
                className={`
                  p-2 rounded-lg border text-center transition-all
                  ${isSelected 
                    ? 'bg-green-600 border-green-600 text-white' 
                    : 'bg-white border-gray-300 text-gray-700 hover:border-green-400'
                  }
                  ${isToday ? 'ring-2 ring-blue-400' : ''}
                `}
              >
                <div className="text-xs font-medium">
                  {format(date, 'EEE', { locale: es })}
                </div>
                <div className="text-sm">
                  {format(date, 'd')}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Address Display */}
      <div className="mb-6 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center text-sm text-gray-600">
          <MapPin className="w-4 h-4 mr-2" />
          <span>Dirección: {clientAddress || 'No especificada'}</span>
        </div>
      </div>

      {/* Time Blocks Grid */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">
          Horarios disponibles para {format(selectedDate, 'd MMMM yyyy', { locale: es })}
        </h4>
        
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
            <span className="ml-2 text-gray-600">Cargando horarios...</span>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {timeBlocks.map((timeBlock) => {
              const blockId = `time-${timeBlock.hour}`;
              const status = getBlockStatus(blockId);
              const styles = getBlockStyles(status);
              
              return (
                <button
                  key={blockId}
                  onClick={() => toggleBlockSelection(blockId)}
                  disabled={status === 'unavailable'}
                  className={`
                    p-3 rounded-lg border-2 transition-all duration-200 text-center
                    ${styles}
                  `}
                >
                  <div className="text-sm font-medium">
                    {timeBlock.start_time}
                  </div>
                  <div className="text-xs opacity-75">
                    {timeBlock.end_time}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selection Summary */}
      {selectedBlocks.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-green-800">Resumen de la reserva</h4>
              <p className="text-sm text-green-600">
                {totalHours} hora{totalHours !== 1 ? 's' : ''} seleccionada{totalHours !== 1 ? 's' : ''}
              </p>
              <div className="text-xs text-green-600 mt-1">
                Horarios: {selectedBlocks.length > 0 
                  ? selectedBlocks.map(block => `${block.start_time}-${block.end_time}`).join(', ')
                  : 'Ninguno seleccionado'
                }
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center text-lg font-bold text-green-800">
                <Clock className="w-5 h-5 mr-1" />
                {totalHours} hora{totalHours !== 1 ? 's' : ''}
              </div>
              <div className="text-xs text-green-600">
                Bloques seleccionados
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="mt-4 text-xs text-gray-500 text-center">
        Selecciona los bloques de tiempo que necesitas. Cada bloque representa 1 hora de servicio.
        Los bloques en verde están disponibles para reservar.
      </div>
    </div>
  );
};

export default TimeBlockSelector;