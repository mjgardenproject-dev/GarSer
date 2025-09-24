import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Minus, Plus } from 'lucide-react';
import googleMapsLoader from '../../lib/googleMapsLoader';

interface DistanceMapSelectorProps {
  address: string;
  distance: number;
  onDistanceChange: (distance: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  error?: string;
}

const DistanceMapSelector: React.FC<DistanceMapSelectorProps> = ({
  address,
  distance,
  onDistanceChange,
  min = 1,
  max = 100,
  step = 1,
  className = "",
  error
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [circle, setCircle] = useState<google.maps.Circle | null>(null);
  const [marker, setMarker] = useState<google.maps.Marker | null>(null);
  const [center, setCenter] = useState<google.maps.LatLngLiteral>({ lat: 40.4168, lng: -3.7038 }); // Madrid por defecto
  const [isLoading, setIsLoading] = useState(true);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);

  // Cargar Google Maps API usando el loader centralizado
  useEffect(() => {
    if (googleMapsLoader.isGoogleMapsLoaded()) {
      setIsGoogleMapsLoaded(true);
    } else {
      googleMapsLoader.load()
        .then(() => {
          setIsGoogleMapsLoaded(true);
        })
        .catch((error) => {
          console.error('Error loading Google Maps:', error);
          setIsLoading(false);
        });
    }
  }, []);

  // Inicializar el mapa
  useEffect(() => {
    if (mapRef.current && !map && isGoogleMapsLoaded) {
      const newMap = new google.maps.Map(mapRef.current, {
        zoom: 12,
        center: center,
        mapTypeId: google.maps.MapTypeId.ROADMAP,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
          }
        ]
      });
      setMap(newMap);
      setIsLoading(false);
    }
  }, [map, center, isGoogleMapsLoaded]);

  // Geocodificar la dirección cuando cambie
  useEffect(() => {
    if (!address || !map || !isGoogleMapsLoaded) return;

    const geocoder = new google.maps.Geocoder();
    geocoder.geocode({ address: address }, (results, status) => {
      if (status === 'OK' && results && results[0]) {
        const location = results[0].geometry.location;
        const newCenter = {
          lat: location.lat(),
          lng: location.lng()
        };
        
        setCenter(newCenter);
        map.setCenter(newCenter);

        // Crear o actualizar el marcador
        if (marker) {
          marker.setMap(null);
        }
        
        const newMarker = new google.maps.Marker({
          position: newCenter,
          map: map,
          title: 'Tu ubicación',
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#3B82F6',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 2
          }
        });
        
        setMarker(newMarker);
      }
    });
  }, [address, map, isGoogleMapsLoaded]);

  // Actualizar círculo cuando cambie la distancia
  useEffect(() => {
    if (!map || !center || !isGoogleMapsLoaded) return;

    // Limpiar círculo anterior
    if (circle) {
      circle.setMap(null);
    }

    // Crear nuevo círculo
    const newCircle = new google.maps.Circle({
      strokeColor: '#3B82F6',
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: '#3B82F6',
      fillOpacity: 0.15,
      map: map,
      center: center,
      radius: distance * 1000 // Convertir km a metros
    });

    setCircle(newCircle);

    // Ajustar el zoom para mostrar todo el círculo
    const listener = google.maps.event.addListenerOnce(map, 'bounds_changed', () => {
      const bounds = newCircle.getBounds();
      if (bounds) {
        map.fitBounds(bounds);
        if (map.getZoom() && map.getZoom()! > 15) {
          map.setZoom(15);
        }
      }
    });

    // Trigger bounds_changed
    google.maps.event.trigger(map, 'bounds_changed');

    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [map, center, distance, isGoogleMapsLoaded]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value);
    onDistanceChange(newValue);
  };

  const handleIncrement = () => {
    if (distance < max) {
      onDistanceChange(Math.min(distance + step, max));
    }
  };

  const handleDecrement = () => {
    if (distance > min) {
      onDistanceChange(Math.max(distance - step, min));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value) || min;
    if (newValue >= min && newValue <= max) {
      onDistanceChange(newValue);
    }
  };

  // Calcular el porcentaje para el indicador visual
  const percentage = ((distance - min) / (max - min)) * 100;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <MapPin className="h-5 w-5 text-green-600" />
          <span className="text-sm font-medium text-gray-700">
            Radio de servicio
          </span>
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleDecrement}
            disabled={distance <= min}
            className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            value={distance}
            onChange={handleInputChange}
            min={min}
            max={max}
            className="w-16 px-2 py-1 text-center border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <span className="text-sm text-gray-500">km</span>
          <button
            type="button"
            onClick={handleIncrement}
            disabled={distance >= max}
            className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Slider */}
      <div className="relative">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={distance}
          onChange={handleSliderChange}
          onMouseDown={() => setIsDragging(true)}
          onMouseUp={() => setIsDragging(false)}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer slider"
          style={{
            background: `linear-gradient(to right, #10b981 0%, #10b981 ${percentage}%, #e5e7eb ${percentage}%, #e5e7eb 100%)`
          }}
        />
        
        {/* Marcadores de distancia */}
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>{min} km</span>
          <span>{Math.floor((min + max) / 2)} km</span>
          <span>{max} km</span>
        </div>
      </div>

      {/* Mapa de Google Maps */}
      <div className="relative bg-gray-50 rounded-lg overflow-hidden border border-gray-200">
        <div 
          ref={mapRef}
          className="w-full h-80"
          style={{ minHeight: '320px' }}
        />
        
        {/* Etiqueta de distancia */}
        <div className="absolute top-4 right-4 bg-white px-3 py-2 rounded-lg shadow-lg text-sm font-medium border">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <span>Radio: {distance} km</span>
          </div>
        </div>

        {/* Indicador de carga */}
        {!map && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-500 mx-auto mb-2"></div>
              <p className="text-sm text-gray-500">Cargando mapa...</p>
            </div>
          </div>
        )}
      </div>

      {/* Descripción */}
      <p className="text-xs text-gray-500">
        Selecciona el radio máximo en el que estás dispuesto a ofrecer tus servicios de jardinería.
      </p>

      {/* Error */}
      {error && (
        <p className="text-sm text-red-600">{error}</p>
      )}

      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .slider::-moz-range-thumb {
          height: 20px;
          width: 20px;
          border-radius: 50%;
          background: #10b981;
          cursor: pointer;
          border: 2px solid #ffffff;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }
      `}</style>
    </div>
  );
};

export default DistanceMapSelector;