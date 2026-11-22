import React from 'react';
import AddressAutocomplete from '../common/AddressAutocomplete';
import DistanceMapSelector from '../common/DistanceMapSelector';

// Paso 1 del cuestionario: «Confirma dónde ofreces tus servicios». Dirección (Google), radio con botones
// rápidos y el mapa de siempre con el círculo. Guarda en `gardener_profiles` como «Cobertura».

const RADIUS_CHIPS = [10, 20, 30, 50];

interface Props {
  address: string;
  maxDistance: number;
  onAddressChange: (address: string) => void;
  onDistanceChange: (km: number) => void;
  error?: string | null;
}

/** «Marbella» de «Calle X, 29600 Marbella, Málaga, España»: lo que se entiende en una frase. */
export function placeLabel(address: string): string {
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length <= 2) return parts[0];
  const city = parts[parts.length - 3] ?? parts[0];
  return city.replace(/^\d{5}\s+/, '');
}

const ZoneStep: React.FC<Props> = ({ address, maxDistance, onAddressChange, onDistanceChange, error }) => {
  const place = placeLabel(address);
  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-gray-900">Confirma dónde ofreces tus servicios</h1>
      <p className="mt-2 text-gray-700">Los clientes de esta zona podrán reservarte.</p>

      <label htmlFor="activation-address" className="mt-5 block text-sm font-semibold text-gray-800">
        Dirección desde la que trabajas
      </label>
      <div className="mt-1">
        <AddressAutocomplete id="activation-address" value={address} onChange={onAddressChange} placeholder="Calle, número y ciudad" />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <p className="mt-5 text-sm font-semibold text-gray-800">¿Hasta dónde te desplazas?</p>
      <div className="mt-2 grid grid-cols-4 gap-2" role="group" aria-label="Kilómetros">
        {RADIUS_CHIPS.map((km) => (
          <button
            key={km}
            type="button"
            onClick={() => onDistanceChange(km)}
            aria-pressed={maxDistance === km}
            className={`min-h-11 rounded-xl border text-base font-semibold [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
              maxDistance === km ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
            }`}
          >
            {km} km
          </button>
        ))}
      </div>

      <div className="mt-4">
        <DistanceMapSelector address={address} distance={maxDistance} onDistanceChange={onDistanceChange} />
      </div>

      {place && (
        <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900" aria-live="polite">
          Te verán los clientes a menos de <strong>{maxDistance} km</strong> de <strong>{place}</strong>.
        </p>
      )}
    </div>
  );
};

export default ZoneStep;
