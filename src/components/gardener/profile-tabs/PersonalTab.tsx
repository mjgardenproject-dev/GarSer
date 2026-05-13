import React from 'react';
import { useFormContext } from 'react-hook-form';
import { User } from 'lucide-react';
import PhytosanitaryLicenseUpload from '../PhytosanitaryLicenseUpload';
import { useAutoSave } from '../../../hooks/useAutoSave';
import SaveStatusIndicator from '../../common/SaveStatusIndicator';

interface PersonalTabProps {
  loading: boolean;
  setLicenseStatus: (status: 'pending' | 'approved' | 'rejected' | null) => void;
  initialData?: {
    full_name: string;
    phone: string;
    description: string;
  };
  onSave: (data: any) => void;
}

const PersonalTab: React.FC<PersonalTabProps> = ({ 
  loading, 
  setLicenseStatus,
  initialData,
  onSave
}) => {
  const { register, watch, getValues, formState: { errors } } = useFormContext();

  const watchedValues = watch(['full_name', 'phone', 'description']);
  const currentValues = {
    full_name: watchedValues[0],
    phone: watchedValues[1],
    description: watchedValues[2]
  };

  const { status } = useAutoSave({
    value: currentValues,
    initialValue: initialData || { full_name: '', phone: '', description: '' },
    onSave: () => onSave(getValues()),
    validate: (val) => {
      const errs: string[] = [];
      if (!val.full_name) errs.push('Nombre requerido');
      if (!val.phone) errs.push('Teléfono requerido');
      if (!val.description) errs.push('Descripción requerida');
      return errs;
    }
  });

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between border-b pb-4">
          <h3 className="text-lg font-bold text-gray-900 flex items-center">
            <User className="w-5 h-5 mr-2 text-green-600" />
            Información Personal
          </h3>
          <SaveStatusIndicator status={status} />
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Nombre completo</label>
            <input 
              {...register('full_name')} 
              type="text" 
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" 
              placeholder="Tu nombre completo" 
            />
            {errors.full_name && <p className="mt-1 text-sm text-red-600">{errors.full_name.message as string}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
            <input 
              {...register('phone')} 
              type="tel" 
              inputMode="tel"
              autoComplete="tel"
              className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" 
              placeholder="+34 600 000 000" 
            />
            {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message as string}</p>}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Descripción profesional</label>
          <textarea 
            {...register('description')} 
            rows={4} 
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" 
            placeholder="Describe tu experiencia..." 
          />
          {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description.message as string}</p>}
        </div>
      </div>

      <PhytosanitaryLicenseUpload onStatusChange={setLicenseStatus} />
    </div>
  );
};

export default PersonalTab;
