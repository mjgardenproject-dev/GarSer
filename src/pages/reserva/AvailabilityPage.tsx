import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronLeft, Calendar, Clock, MapPin } from 'lucide-react';
import { supabase } from '../../lib/supabase';

interface AvailabilitySlot {
  id: string;
  date: string;
  time: string;
  available: boolean;
  provider_id: string;
  provider_name: string;
  price: number;
}

const AvailabilityPage: React.FC = () => {
  const navigate = useNavigate();
  const { bookingData, setBookingData, saveProgress, setCurrentStep } = useBooking();
  const [selectedDate, setSelectedDate] = useState<string>(bookingData.preferredDate || '');
  const [selectedSlot, setSelectedSlot] = useState<string>(bookingData.timeSlot || '');
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(() => {
    return bookingData.preferredDate ? new Date(bookingData.preferredDate) : new Date();
  });

  useEffect(() => {
    fetchAvailability();
  }, []);

  useEffect(() => {
    if (selectedDate && selectedSlot) {
      saveProgress();
    }
  }, [selectedDate, selectedSlot]);

  const fetchAvailability = async () => {
    try {
      // Simular disponibilidad basada en los servicios seleccionados
      const mockAvailability: AvailabilitySlot[] = [];
      const today = new Date();
      
      for (let i = 0; i < 14; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        
        // Generar slots cada hora de 9:00 a 18:00
        for (let hour = 9; hour <= 18; hour++) {
          if (Math.random() > 0.3) { // 70% de disponibilidad
            mockAvailability.push({
              id: `${dateStr}-${hour}`,
              date: dateStr,
              time: `${hour.toString().padStart(2, '0')}:00`,
              available: true,
              provider_id: `provider-${Math.floor(Math.random() * 3) + 1}`,
              provider_name: ['Juan', 'María', 'Carlos'][Math.floor(Math.random() * 3)],
              price: 25 + Math.random() * 20,
            });
          }
        }
      }
      
      setAvailability(mockAvailability);

      // Si no hay fecha seleccionada previamente, seleccionar el primer día con disponibilidad real
      if (!bookingData.preferredDate) {
        const sortedSlots = [...mockAvailability].sort((a, b) => 
          new Date(`${a.date}T${a.time}`).getTime() - new Date(`${b.date}T${b.time}`).getTime()
        );

        const firstAvailable = sortedSlots.find(slot => slot.available);
        
        if (firstAvailable) {
          setSelectedDate(firstAvailable.date);
          setCurrentWeek(new Date(firstAvailable.date));
        }
      }
    } catch (error) {
      console.error('Error fetching availability:', error);
    } finally {
      setLoading(false);
    }
  };

  const getWeekDays = () => {
    const days = [];
    const startOfWeek = new Date(currentWeek);
    startOfWeek.setDate(currentWeek.getDate() - currentWeek.getDay());
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(startOfWeek.getDate() + i);
      days.push(day);
    }
    return days;
  };

  const handleDateSelect = (date: string) => {
    setSelectedDate(date);
    setSelectedSlot(''); // Reset time slot when date changes
  };

  const handleSlotSelect = (slotId: string) => {
    setSelectedSlot(slotId);
    const slot = availability.find(s => s.id === slotId);
    if (slot) {
      setBookingData({ 
        preferredDate: slot.date, 
        timeSlot: slot.time 
      });
    }
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() + (direction === 'next' ? 7 : -7));
    setCurrentWeek(newWeek);
  };

  const handleContinue = () => {
    if (selectedDate && selectedSlot) {
      saveProgress();
      setCurrentStep(5);
    }
  };

  const weekDays = getWeekDays();
  const slotsForSelectedDate = availability.filter(slot => slot.date === selectedDate);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Cargando disponibilidad...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6 flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(3)}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Disponibilidad</h1>
          <div className="w-9" />
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-white">
        <div className="max-w-md mx-auto px-4 py-3">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 4 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '80%' }} />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-md mx-auto px-4 py-6">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            ¿Cuándo necesitas el servicio?
          </h2>
          <p className="text-gray-600">
            Selecciona la fecha y hora que mejor te convenga
          </p>
        </div>

        {/* Week Navigation */}
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateWeek('prev')}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              ←
            </button>
            <h3 className="font-semibold text-gray-900">
              {currentWeek.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
            </h3>
            <button
              onClick={() => navigateWeek('next')}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              →
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((day, index) => (
              <div key={index} className="text-center text-xs font-medium text-gray-500 py-2">
                {day}
              </div>
            ))}
            {weekDays.map((day, index) => {
              const dateStr = day.toISOString().split('T')[0];
              const hasAvailability = availability.some(slot => slot.date === dateStr && slot.available);
              const isSelected = selectedDate === dateStr;
              const isToday = day.toDateString() === new Date().toDateString();

              return (
                <button
                  key={index}
                  onClick={() => handleDateSelect(dateStr)}
                  className={`p-3 rounded-xl text-center transition-all ${
                    isSelected
                      ? 'bg-green-600 text-white shadow-lg'
                      : hasAvailability
                      ? 'bg-green-50 text-green-800 hover:bg-green-100'
                      : 'bg-gray-50 text-gray-400'
                  } ${isToday ? 'ring-2 ring-green-300' : ''}`}
                >
                  <div className="text-sm font-medium">{day.getDate()}</div>
                  {hasAvailability && (
                    <div className="w-2 h-2 bg-green-500 rounded-full mx-auto mt-1"></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Time Slots */}
        {selectedDate && (
          <div className="bg-white rounded-2xl shadow-sm p-4 mb-4">
            <div className="flex items-center mb-4">
              <Calendar className="w-5 h-5 text-gray-600 mr-2" />
              <h3 className="font-semibold text-gray-900">
                {new Date(selectedDate).toLocaleDateString('es-ES', { 
                  weekday: 'long', 
                  day: 'numeric', 
                  month: 'long' 
                })}
              </h3>
            </div>

            {slotsForSelectedDate.length > 0 ? (
              <div className="grid grid-cols-3 gap-2">
                {slotsForSelectedDate.map((slot) => (
                  <button
                    key={slot.id}
                    onClick={() => handleSlotSelect(slot.id)}
                    className={`p-3 rounded-xl text-center transition-all ${
                      selectedSlot === slot.id
                        ? 'bg-green-600 text-white shadow-lg'
                        : 'bg-gray-50 text-gray-700 hover:bg-green-50'
                    }`}
                  >
                    <div className="flex items-center justify-center mb-1">
                      <Clock className="w-3 h-3 mr-1" />
                      <span className="text-sm font-medium">{slot.time}</span>
                    </div>
                    <div className="text-xs text-green-600">€{slot.price.toFixed(0)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-gray-500 text-sm">No hay disponibilidad para este día</p>
              </div>
            )}
          </div>
        )}

        {/* Location Summary */}
        {bookingData.address && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center space-x-3">
              <MapPin className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-sm font-medium text-blue-900">Ubicación</p>
                <p className="text-sm text-blue-700">{bookingData.address}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleContinue}
            disabled={!selectedDate || !selectedSlot}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
          >
            {selectedDate && selectedSlot 
              ? 'Ver jardineros disponibles'
              : 'Selecciona fecha y hora'
            }
          </button>
        </div>
      </div>
    </div>
  );
};

export default AvailabilityPage;
