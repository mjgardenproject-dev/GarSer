import React from 'react';
import { useFormContext } from 'react-hook-form';
import { MapPin } from 'lucide-react';
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
  onSave: (data: any) => void;
}

const CoverageTab: React.FC<CoverageTabProps> = ({ 
  loading,
  initialData,
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
    onSave: () => onSave(getValues()),
    validate: (val) => {
      const errs: string[] = [];
      if (!val.address) errs.push('Dirección requerida');
      if (val.max_distance < 1 || val.max_distance > 100) errs.push('Distancia inválida');
      return errs;
    }
  });

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
