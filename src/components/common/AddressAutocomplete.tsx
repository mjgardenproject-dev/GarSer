import React, { useState, useRef, useEffect } from 'react';
import { MapPin, ChevronDown, Loader2 } from 'lucide-react';
import googleMapsLoader from '../../lib/googleMapsLoader';

interface AddressAutocompleteProps {
  value: string;
  onChange: (address: string) => void;
  placeholder?: string;
  className?: string;
  error?: string;
}

const AddressAutocomplete: React.FC<AddressAutocompleteProps> = ({
  value,
  onChange,
  placeholder = "Buscar dirección...",
  className = "",
  error
}) => {
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isGoogleMapsLoaded, setIsGoogleMapsLoaded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout>();

  // Cargar Google Maps JavaScript API usando el loader centralizado
  useEffect(() => {
    const initializeAutocompleteService = () => {
      try {
        if (window.google && window.google.maps && window.google.maps.places) {
          setIsGoogleMapsLoaded(true);
          console.log('Google Maps Places API initialized successfully');
        } else {
          console.error('Google Maps Places library not available');
          setIsGoogleMapsLoaded(false);
        }
      } catch (error) {
        console.error('Error initializing Google Maps Places API:', error);
        setIsGoogleMapsLoaded(false);
      }
    };

    // Usar el loader centralizado
    if (googleMapsLoader.isGoogleMapsLoaded()) {
      initializeAutocompleteService();
    } else {
      googleMapsLoader.load()
        .then(initializeAutocompleteService)
        .catch((error) => {
          console.error('Error loading Google Maps API:', error);
          setIsGoogleMapsLoaded(false);
        });
    }
  }, []);

  // Función para buscar direcciones usando la API legacy como principal
  const searchAddresses = async (input: string) => {
    if (!isGoogleMapsLoaded || input.length < 3) {
      setSuggestions([]);
      setIsOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Usar la API legacy como principal para mayor estabilidad
      if (window.google?.maps?.places?.AutocompleteService) {
        const service = new window.google.maps.places.AutocompleteService();
        const request = {
          input,
          componentRestrictions: { country: 'es' },
          types: ['address']
        };

        service.getPlacePredictions(request, (predictions: any[], status: any) => {
          setLoading(false);
          
          if (status === window.google.maps.places.PlacesServiceStatus.OK && predictions) {
            setSuggestions(predictions);
            setIsOpen(predictions.length > 0);
            console.log('Autocomplete predictions received:', predictions.length);
          } else {
            setSuggestions([]);
            setIsOpen(false);
            console.log('No predictions found or error:', status);
          }
        });
      } else {
        // Fallback a la nueva API si la legacy no está disponible
        if (window.google?.maps?.places?.AutocompleteSuggestion?.fetchAutocompleteSuggestions) {
          const request = {
            input,
            locationRestriction: { 
              country: ['es'] 
            },
            includedPrimaryTypes: ['address']
          };

          const { suggestions } = await window.google.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
          
          setLoading(false);
          
          if (suggestions && suggestions.length > 0) {
            // Convertir el formato de la nueva API al formato esperado
            const formattedSuggestions = suggestions.map((suggestion: any) => ({
              place_id: suggestion.placePrediction?.placeId || suggestion.placeId,
              description: suggestion.placePrediction?.text?.text || suggestion.text,
              structured_formatting: {
                main_text: suggestion.placePrediction?.structuredFormat?.mainText?.text || suggestion.mainText || suggestion.text,
                secondary_text: suggestion.placePrediction?.structuredFormat?.secondaryText?.text || suggestion.secondaryText || ''
              }
            }));
            
            setSuggestions(formattedSuggestions);
            setIsOpen(formattedSuggestions.length > 0);
            console.log('Autocomplete suggestions received (new API):', formattedSuggestions.length);
          } else {
            setSuggestions([]);
            setIsOpen(false);
          }
        } else {
          console.error('Ninguna API de autocompletado disponible');
          setLoading(false);
          setSuggestions([]);
          setIsOpen(false);
        }
      }
    } catch (error) {
      console.error('Error en búsqueda de direcciones:', error);
      setLoading(false);
      setSuggestions([]);
      setIsOpen(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    onChange(inputValue);

    // Limpiar timeout anterior
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (inputValue.length > 2) {
      console.log('Starting autocomplete search for:', inputValue);
      console.log('Google Maps loaded:', isGoogleMapsLoaded);
      console.log('New AutocompleteSuggestion API available:', !!window.google?.maps?.places?.AutocompleteSuggestion);
      
      // Debounce la búsqueda
      timeoutRef.current = setTimeout(() => {
        searchAddresses(inputValue);
      }, 300);
    } else {
      setSuggestions([]);
      setIsOpen(false);
      setLoading(false);
    }
  };

  const handleSuggestionClick = (suggestion: any) => {
    // Construir una dirección más completa combinando main + secondary
    const main = suggestion?.structured_formatting?.main_text || '';
    const secondary = suggestion?.structured_formatting?.secondary_text || '';
    const fullAddress = [main, secondary].filter(Boolean).join(', ');
    const valueToUse = fullAddress || suggestion.description;
    console.log('Address selected:', { fullAddress, description: suggestion.description });
    onChange(valueToUse);
    setIsOpen(false);
    setSuggestions([]);
  };

  const handleClickOutside = (event: MouseEvent) => {
    if (
      dropdownRef.current &&
      !dropdownRef.current.contains(event.target as Node) &&
      inputRef.current &&
      !inputRef.current.contains(event.target as Node)
    ) {
      setIsOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={handleInputChange}
          placeholder={placeholder}
          className={`w-full px-4 py-3 pl-12 pr-12 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent ${
            error ? 'border-red-500' : 'border-gray-300'
          }`}
        />
        <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5 animate-spin" />
        )}
        {!loading && value && (
          <ChevronDown className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
        )}
      </div>

      {error && (
        <p className="mt-1 text-sm text-red-600">{error}</p>
      )}

      {!isGoogleMapsLoaded && (
        <p className="mt-1 text-sm text-yellow-600">Cargando servicio de direcciones...</p>
      )}

      {isOpen && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        >
          {suggestions.map((suggestion) => (
            <div
              key={suggestion.place_id}
              onClick={() => handleSuggestionClick(suggestion)}
              className="px-4 py-3 hover:bg-gray-50 cursor-pointer border-b border-gray-100 last:border-b-0 flex items-center"
            >
              <MapPin className="h-4 w-4 text-gray-400 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <div className="text-sm text-gray-900">{suggestion.structured_formatting.main_text}</div>
                <div className="text-xs text-gray-500">{suggestion.structured_formatting.secondary_text}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AddressAutocomplete;