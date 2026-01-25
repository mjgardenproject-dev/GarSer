// Función para calcular la distancia entre dos coordenadas usando la fórmula de Haversine
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Radio de la Tierra en kilómetros
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

// Función para obtener coordenadas de una dirección usando Google Maps Geocoding
export const getCoordinatesFromAddress = async (address: string): Promise<{lat: number, lng: number} | null> => {
  try {
    // Asegurar que Google Maps está cargado
    try {
      if (!window.google?.maps) {
        await googleMapsLoader.load();
      }
    } catch (e) {
      console.warn('No se pudo cargar Google Maps con el loader:', e);
    }

    let coords: { lat: number, lng: number } | null = null;

    // Intentar primero con Geocoder
    if (window.google?.maps?.Geocoder) {
      const geocoder = new window.google.maps.Geocoder();
      coords = await new Promise<{lat: number, lng: number} | null>((resolve) => {
        geocoder.geocode({ address }, (results, status) => {
          if (status === 'OK' && results && results[0]) {
            const location = results[0].geometry.location;
            resolve({ lat: location.lat(), lng: location.lng() });
          } else {
            console.warn('[geolocation] Geocoding falló, intento PlacesService:', status);
            resolve(null);
          }
        });
      });
    }

    // Fallback: usar PlacesService.findPlaceFromQuery si Geocoder falló o no disponible
    if (!coords && window.google?.maps?.places?.PlacesService) {
      const service = new window.google.maps.places.PlacesService(document.createElement('div'));
      coords = await new Promise<{lat: number, lng: number} | null>((resolve) => {
        const request: any = { query: address, fields: ['geometry'] };
        service.findPlaceFromQuery(request, (results: any[], status: any) => {
          if (status === window.google.maps.places.PlacesServiceStatus.OK && results && results[0]?.geometry?.location) {
            const loc = results[0].geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng() });
          } else {
            console.error('[geolocation] PlacesService no pudo resolver dirección:', status);
            resolve(null);
          }
        });
      });
    }

    if (!coords) {
      console.error('[geolocation] Google Maps Geocoder y PlacesService no resolvieron la dirección');
    }
    return coords;
  } catch (error) {
    console.error('Error en geocoding:', error);
    return null;
  }
};

// Declaración de tipos para Google Maps
declare global {
  interface Window {
    google: {
      maps: {
        Geocoder: new () => google.maps.Geocoder;
        places: {
          PlacesService: new (node: Element) => google.maps.places.PlacesService;
          PlacesServiceStatus: any;
        };
      };
    };
  }
}
import googleMapsLoader from '../lib/googleMapsLoader';