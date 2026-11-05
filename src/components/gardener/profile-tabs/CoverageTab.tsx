import React, { useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { CheckCircle2, Loader2, MapPin } from 'lucide-react';
import AddressAutocomplete from '../../common/AddressAutocomplete';
import DistanceMapSelector from '../../common/DistanceMapSelector';
import { useAutoSave } from '../../../hooks/useAutoSave';
import SaveStatusIndicator from '../../common/SaveStatusIndicator';

interface CoverageTabProps {
  loading: boolean;
  initialData?: {
    address: string;
    max_distance: number;
  };
  hasOperationalCoordinates?: boolean;
  /** Guarda el perfil; devuelve `true` si se guardó. `successMessage` cambia el aviso. */
  onSave: (data: any, opts?: { successMessage?: string }) => unknown;
}

const CoverageTab: React.FC<CoverageTabProps> = ({ 
  loading,
  initialData,
  hasOperationalCoordinates = false,
  onSave
}) => {
  const { watch, setValue, getValues, formState: { errors } } = useFormContext();

  const watchedValues = watch(['address', 'max_distance']);
  const currentValues = {
    address: watchedValues[0],
    max_distance: watchedValues[1]
  };

  const { status } = useAutoSave({
    value: currentValues,
    initialValue: initialData || { address: '', max_distance: 25 },
    onSave: async () => { await onSave(getValues()); },
    validate: (val) => {
      const errs: string[] = [];
      if (!val.address) errs.push('Dirección requerida');
      if (val.max_distance < 1 || val.max_distance > 100) errs.push('Distancia inválida');
      return errs;
    }
  });

  const address = String(watchedValues[0] || '').trim();
  const radius = Number(watchedValues[1]) || 25;
  const [confirming, setConfirming] = useState(false);
  const [confirmFailed, setConfirmFailed] = useState(false);

  // La dirección que trae una cuenta recién aprobada es la de su solicitud: está escrita, pero nunca se
  // ha localizado en el mapa (sin coordenadas) y el guardado automático solo actúa cuando algo
  // CAMBIA. Sin tocarla, no contaba y la ayuda seguía pidiendo la zona (fallo 4, 2026-11-05). Este
  // botón hace ese primer guardado: el mismo de siempre, con la dirección y el radio que se ven.
  const needsConfirmation = !hasOperationalCoordinates && address.length > 0;

  const confirmAddress = async () => {
    if (confirming) return;
    setConfirming(true);
    setConfirmFailed(false);
    try {
      const saved = await onSave(getValues(), { successMessage: 'Zona de trabajo confirmada' });
      if (saved === false) setConfirmFailed(true);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <h3 className="text-lg font-bold text-gray-900 flex items-center">
          <MapPin className="w-5 h-5 mr-2 text-green-600" />
          Cobertura y Zonas
        </h3>
        <SaveStatusIndicator status={status} />
      </div>
      
      <div className="space-y-6">
        {hasOperationalCoordinates ? (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span><span className="font-semibold">Zona confirmada.</span> Los clientes de tu zona ya pueden verte.</span>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-semibold">Falta confirmar tu zona de trabajo</p>
            <p className="mt-1">
              {address
                ? 'Tu dirección ya está escrita, pero todavía no la hemos comprobado en el mapa. Revisa la dirección y los kilómetros y pulsa el botón.'
                : 'Escribe la dirección desde la que trabajas y elige cuántos kilómetros te desplazas.'}
            </p>
            {needsConfirmation && (
              <>
                <p className="mt-2 rounded-lg bg-white/70 px-3 py-2 text-gray-800">
                  <span className="block break-words font-medium">{address}</span>
                  <span className="block text-gray-600">Hasta {radius} km</span>
                </p>
                <button
                  type="button"
                  onClick={() => void confirmAddress()}
                  disabled={confirming || loading}
                  className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 text-base font-bold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]"
                >
                  {confirming ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                  {confirming ? 'Comprobando…' : 'Confirmar esta dirección'}
                </button>
                {confirmFailed && (
                  <p role="alert" className="mt-2 text-red-700">
                    No hemos podido localizar esa dirección. Bórrala y vuelve a escribirla eligiendo una de las sugerencias.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Dirección base</label>
          <AddressAutocomplete 
            value={watch('address') || ''} 
            onChange={(address) => setValue('address', address)} 
            placeholder="Tu dirección de trabajo" 
          />
          {errors.address && <p className="mt-1 text-sm text-red-600">{errors.address.message as string}</p>}
        </div>
        <div>
          <DistanceMapSelector 
            address={watch('address') || ''} 
            distance={watch('max_distance') || 25} 
            onDistanceChange={(d) => setValue('max_distance', d)} 
          />
          {errors.max_distance && <p className="mt-1 text-sm text-red-600">{errors.max_distance.message as string}</p>}
        </div>
      </div>
    </div>
  );
};

export default CoverageTab;
