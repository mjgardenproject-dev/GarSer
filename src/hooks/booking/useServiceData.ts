import { useCallback } from 'react';

export const useServiceData = ({ bookingData, setBookingData, updateServiceData, saveProgress, debugService }: any) => {
  const handleToggleWeedingHerbicide = useCallback(() => {
    const currentZones = bookingData.weedingZones || [];
    if (currentZones.length === 0) return;
    
    const nextZones = [{
      ...currentZones[0],
      applyHerbicide: !currentZones[0].applyHerbicide
    }];
    
    setBookingData({ weedingZones: nextZones });
    if (bookingData.serviceIds?.[0]) {
      updateServiceData(bookingData.serviceIds[0], { weedingZones: nextZones });
    }
    saveProgress();
  }, [bookingData, setBookingData, updateServiceData, saveProgress]);

  return {
    handleToggleWeedingHerbicide,
    updateServiceData,
    saveProgress
  };
};
