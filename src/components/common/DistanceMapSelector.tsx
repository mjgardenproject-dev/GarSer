import React, { useState } from 'react';
import { MapPin, Minus, Plus } from 'lucide-react';

interface DistanceMapSelectorProps {
  value: number;
  onChange: (distance: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  error?: string;
}

const DistanceMapSelector: React.FC<DistanceMapSelectorProps> = ({
  value,
  onChange,
  min = 1,
  max = 100,
  step = 1,
  className = "",
  error
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value);
    onChange(newValue);
  };

  const handleIncrement = () => {
    if (value < max) {
      onChange(Math.min(value + step, max));
    }
  };

  const handleDecrement = () => {
    if (value > min) {
      onChange(Math.max(value - step, min));
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = parseInt(e.target.value) || min;
    if (newValue >= min && newValue <= max) {
      onChange(newValue);
    }
  };

  // Calcular el porcentaje para el indicador visual
  const percentage = ((value - min) / (max - min)) * 100;

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
            disabled={value <= min}
            className="p-1 rounded-full bg-gray-100 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            value={value}
            onChange={handleInputChange}
            min={min}
            max={max}
            className="w-16 px-2 py-1 text-center border border-gray-300 rounded focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <span className="text-sm text-gray-500">km</span>
          <button
            type="button"
            onClick={handleIncrement}
            disabled={value >= max}
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
          value={value}
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

      {/* Mapa visual simplificado */}
      <div className="relative bg-gray-50 rounded-lg p-4 h-32 overflow-hidden">
        <div className="absolute inset-0 flex items-center justify-center">
          {/* Centro (ubicación del jardinero) */}
          <div className="relative">
            <div className="w-3 h-3 bg-green-600 rounded-full z-10 relative"></div>
            
            {/* Círculo de radio */}
            <div 
              className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-2 border-green-300 rounded-full transition-all duration-300 ${
                isDragging ? 'border-green-500' : ''
              }`}
              style={{
                width: `${Math.min(percentage * 1.2, 120)}px`,
                height: `${Math.min(percentage * 1.2, 120)}px`,
                opacity: 0.6
              }}
            ></div>
            
            {/* Área de cobertura */}
            <div 
              className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-green-200 rounded-full transition-all duration-300 ${
                isDragging ? 'bg-green-300' : ''
              }`}
              style={{
                width: `${Math.min(percentage * 1.2, 120)}px`,
                height: `${Math.min(percentage * 1.2, 120)}px`,
                opacity: 0.3
              }}
            ></div>
          </div>
        </div>
        
        {/* Etiqueta de distancia */}
        <div className="absolute top-2 right-2 bg-white px-2 py-1 rounded shadow text-xs font-medium">
          {value} km
        </div>
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