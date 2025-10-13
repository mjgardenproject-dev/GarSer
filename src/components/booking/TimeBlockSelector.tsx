import React, { useState, useEffect } from 'react';
import { Calendar, Clock, MapPin, DollarSign } from 'lucide-react';
import { format, addDays, startOfDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { TimeBlock, AvailabilityBlock } from '../../types';
import { generateDailyTimeBlocks } from '../../utils/availabilityService';
import { getAvailableBlocksWithBuffer } from '../../utils/bufferService';
import { getCoordinatesFromAddress, calculateDistance } from '../../utils/geolocation';
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
  const [gardenerDetails, setGardenerDetails] = useState<any[]>([]);
  const [gardenerAvailability, setGardenerAvailability] = useState<Map<string, AvailabilityBlock[]>>(new Map());
  const [selectedGardenerId, setSelectedGardenerId] = useState<string | null>(null);

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
    // Permitir cargar jardineros aunque aún no haya dirección, para mostrar opciones básicas
    if (!serviceId) return;

    try {
      // Get gardeners who offer this service with complete information
      const { data: gardeners, error } = await supabase
        .from('gardener_profiles')
        .select(`
          user_id,
          full_name,
          rating,
          total_reviews,
          max_distance,
          address
        `)
        .contains('services', [serviceId])
        .eq('is_available', true)
        .order('rating', { ascending: false })
        .limit(5); // Maximum 5 gardeners

      if (error) throw error;

      // Filter by distance if client address is provided
      let filteredGardeners = gardeners || [];
      
      if (clientAddress && gardeners) {
        const clientCoords = await getCoordinatesFromAddress(clientAddress);
        if (clientCoords) {
          const gardenersWithDistance = [];
          
          for (const gardener of gardeners) {
            if (gardener.address) {
              const gardenerCoords = await getCoordinatesFromAddress(gardener.address);
              if (gardenerCoords) {
                const distance = calculateDistance(
                  clientCoords.lat,
                  clientCoords.lng,
                  gardenerCoords.lat,
                  gardenerCoords.lng
                );
                
                const maxRange = gardener.max_distance || 25;
                if (distance <= maxRange) {
                  gardenersWithDistance.push({
                    ...gardener,
                    distance
                  });
                }
              }
            }
          }
          
          // Sort by rating first, then by distance
          gardenersWithDistance.sort((a, b) => {
            if (b.rating !== a.rating) {
              return (b.rating || 0) - (a.rating || 0);
            }
            return (a.distance || 0) - (b.distance || 0);
          });
          
          filteredGardeners = gardenersWithDistance;
        }
      }

      const gardenerIds = filteredGardeners.map(g => g.user_id);
      setAvailableGardeners(gardenerIds);
      
      // Store complete gardener information for UI display
      setGardenerDetails(filteredGardeners);
    } catch (error) {
      console.error('Error fetching available gardeners:', error);
      setAvailableGardeners([]);
      setGardenerDetails([]);
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
      
      // Store individual gardener availability
      const gardenerAvailabilityMap = new Map<string, AvailabilityBlock[]>();
      
      blocksMap.forEach((blocks, gardenerId) => {
        const availabilityBlocks: AvailabilityBlock[] = [];
        
        // Convert TimeBlock[] to AvailabilityBlock[] for each gardener
        blocks.forEach(block => {
          if (block.available) {
            availabilityBlocks.push({
              id: `${gardenerId}-${block.hour}`,
              gardener_id: gardenerId,
              date: dateStr,
              hour_block: block.hour,
              is_available: true,
              created_at: new Date().toISOString()
            });
          }
        });
        
        gardenerAvailabilityMap.set(gardenerId, availabilityBlocks);
      });
      
      setGardenerAvailability(gardenerAvailabilityMap);
      
      // For backward compatibility, create a consolidated view
      const allAvailableBlocks: AvailabilityBlock[] = [];
      gardenerAvailabilityMap.forEach((blocks) => {
        allAvailableBlocks.push(...blocks);
      });
      
      setAvailableBlocks(allAvailableBlocks);
      console.log(`Loaded availability for ${gardenerAvailabilityMap.size} gardeners on ${dateStr}`);
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
    return availableBlocks.some(block => block.hour_block === hour && block.is_available);
  };

  const isBlockSelected = (blockId: string): boolean => {
    return selectedBlockIds.includes(blockId);
  };

  const toggleGardenerBlockSelection = (gardenerId: string, hour: number) => {
    const blockId = `gardener-${gardenerId}-time-${hour}`;
    
    setSelectedBlockIds(prev => {
      // If selecting a block from a different gardener, clear previous selection
      if (selectedGardenerId && selectedGardenerId !== gardenerId) {
        const newSelection = [blockId];
        setSelectedGardenerId(gardenerId);
        
        const selectedTimeBlocks = newSelection.map(id => {
          const hourFromId = parseInt(id.split('-time-')[1]);
          const timeBlock = timeBlocks.find(tb => tb.hour === hourFromId);
          if (timeBlock) {
            return {
              ...timeBlock,
              id: id,
              gardener_id: gardenerId,
              start_time: `${hourFromId.toString().padStart(2, '0')}:00`,
              end_time: `${(hourFromId + 1).toString().padStart(2, '0')}:00`
            };
          }
          return null;
        }).filter(Boolean);
        
        onBlocksChange(selectedTimeBlocks);
        return newSelection;
      }
      
      // Toggle selection for the same gardener
      const newSelection = prev.includes(blockId)
        ? prev.filter(id => id !== blockId)
        : [...prev, blockId].sort();
      
      // Set or clear selected gardener
      if (newSelection.length === 0) {
        setSelectedGardenerId(null);
      } else if (!selectedGardenerId) {
        setSelectedGardenerId(gardenerId);
      }
      
      // Get selected time blocks with details
      const selectedTimeBlocks = newSelection.map(id => {
        const hourFromId = parseInt(id.split('-time-')[1]);
        const timeBlock = timeBlocks.find(tb => tb.hour === hourFromId);
        if (timeBlock) {
          return {
            ...timeBlock,
            id: id,
            gardener_id: gardenerId,
            start_time: `${hourFromId.toString().padStart(2, '0')}:00`,
            end_time: `${(hourFromId + 1).toString().padStart(2, '0')}:00`
          };
        }
        return null;
      }).filter(Boolean);
      
      // Get selected gardener details
      const selectedGardener = gardenerDetails.find(g => g.user_id === gardenerId);
      
      // Pass both time blocks and gardener information
      onBlocksChange(selectedTimeBlocks, selectedGardener);
      return newSelection;
    });
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
    setSelectedGardenerId(null);
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

      {/* Gardeners with Available Time Blocks */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">
          Jardineros disponibles para {format(selectedDate, 'd MMMM yyyy', { locale: es })}
        </h4>
        
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
            <span className="ml-2 text-gray-600">Cargando jardineros...</span>
          </div>
        ) : gardenerDetails.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <div className="text-lg mb-2">😔</div>
            <p>No hay jardineros disponibles para esta dirección en la fecha seleccionada.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {gardenerDetails.map((gardener) => {
              const gardenerBlocks = gardenerAvailability.get(gardener.user_id) || [];

              return (
                <div key={gardener.user_id} className="border border-gray-200 rounded-lg p-4 bg-white shadow-sm">
                  {/* Gardener Info */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                        <span className="text-green-600 font-semibold text-sm">
                          {gardener.full_name?.charAt(0) || 'J'}
                        </span>
                      </div>
                      <div>
                        <h5 className="font-medium text-gray-900">{gardener.full_name || 'Jardinero'}</h5>
                        <div className="flex items-center space-x-2 text-sm text-gray-600">
                          <div className="flex items-center">
                            <span className="text-yellow-400">★</span>
                            <span className="ml-1">{gardener.rating?.toFixed(1) || '5.0'}</span>
                          </div>
                          <span>•</span>
                          <span>{gardener.total_reviews || 0} reseñas</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {gardenerBlocks.length} hora{gardenerBlocks.length !== 1 ? 's' : ''} disponible{gardenerBlocks.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  
                  {/* Available Time Blocks for this Gardener */}
                  {gardenerBlocks.length === 0 ? (
                    <div className="py-3 text-sm text-gray-500">
                      No hay bloques disponibles para esta fecha. Prueba con otro día.
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                      {gardenerBlocks.map((block) => {
                      const blockId = `gardener-${gardener.user_id}-time-${block.hour_block}`;
                      const isSelected = selectedBlockIds.includes(blockId);
                      
                      return (
                        <button
                          key={blockId}
                          onClick={() => toggleGardenerBlockSelection(gardener.user_id, block.hour_block)}
                          className={`
                            p-2 rounded-md border transition-all duration-200 text-center text-xs
                            ${isSelected 
                              ? 'bg-green-500 border-green-600 text-white shadow-md transform scale-105' 
                              : 'bg-white border-green-300 text-green-700 hover:bg-green-50 hover:border-green-400'
                            }
                          `}
                        >
                          <div className="font-medium">
                            {block.hour_block.toString().padStart(2, '0')}:00
                          </div>
                          <div className="opacity-75">
                            {(block.hour_block + 1).toString().padStart(2, '0')}:00
                          </div>
                        </button>
                      );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Selection Summary */}
      {selectedBlocks.length > 0 && selectedGardenerId && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium text-green-800">Resumen de la reserva</h4>
              {(() => {
                const selectedGardener = gardenerDetails.find(g => g.user_id === selectedGardenerId);
                return selectedGardener ? (
                  <div className="flex items-center space-x-2 mt-1 mb-2">
                    <div className="w-6 h-6 bg-green-100 rounded-full flex items-center justify-center">
                      <span className="text-green-600 font-semibold text-xs">
                        {selectedGardener.full_name?.charAt(0) || 'J'}
                      </span>
                    </div>
                    <span className="text-sm text-green-700 font-medium">
                      {selectedGardener.full_name || 'Jardinero'}
                    </span>
                    <div className="flex items-center text-xs text-green-600">
                      <span className="text-yellow-400">★</span>
                      <span className="ml-1">{selectedGardener.rating?.toFixed(1) || '5.0'}</span>
                    </div>
                  </div>
                ) : null;
              })()}
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
        Selecciona un jardinero y los bloques de tiempo que necesitas. Cada bloque representa 1 hora de servicio.
        Solo puedes seleccionar horarios de un jardinero a la vez. Los jardineros están ordenados por calificación.
      </div>
    </div>
  );
};

export default TimeBlockSelector;