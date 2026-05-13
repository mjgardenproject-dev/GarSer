import React, { useState, useEffect } from 'react';

interface Props {
  value: number | null | undefined | string;
  onChange: (val: any) => void;
  placeholder?: string;
  hasError?: boolean;
  errorMessage?: string;
  className?: string;
  suffix?: string;
  disabled?: boolean;
  id?: string;
  autoSelect?: boolean;
}

export const UnifiedNumericInput: React.FC<Props> = ({
  value,
  onChange,
  placeholder = '-',
  hasError = false,
  errorMessage,
  className = '',
  suffix = '€',
  disabled = false,
  id,
  autoSelect = false
}) => {
  const [localValue, setLocalValue] = useState('');

  // Sync from prop
  useEffect(() => {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) {
      setLocalValue('');
    } else {
      const parsedLocal = parseFloat(localValue.replace(',', '.'));
      const numValue = Number(value);
      if (isNaN(parsedLocal) || parsedLocal !== numValue) {
        setLocalValue(String(numValue).replace('.', ','));
      }
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let raw = e.target.value;
    
    // Replace dots with commas automatically
    raw = raw.replace(/\./g, ',');
    
    // Remove invalid characters
    raw = raw.replace(/[^0-9,]/g, '');
    
    // Allow only one comma
    const parts = raw.split(',');
    if (parts.length > 2) {
      raw = parts[0] + ',' + parts.slice(1).join('');
    }

    // Auto pad ",5" to "0,5"
    if (raw.startsWith(',')) {
      raw = '0' + raw;
    }

    setLocalValue(raw);

    if (raw === '' || raw === '0,') {
      onChange(null);
    } else {
      // Convert to number
      const numString = raw.replace(',', '.');
      const num = parseFloat(numString);
      if (!Number.isNaN(num)) {
        onChange(num);
      }
    }
  };

  const handleBlur = () => {
    // If it ends with comma, remove it
    if (localValue.endsWith(',')) {
      const newVal = localValue.slice(0, -1);
      setLocalValue(newVal);
      const parsed = parseFloat(newVal.replace(',', '.'));
      onChange(Number.isNaN(parsed) ? null : parsed);
    }
  };

  return (
    <div className="relative w-full">
      <div className="relative w-full">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          className={`w-full h-11 pl-3 pr-8 border rounded-lg text-right text-sm transition-all focus:ring-2 focus:ring-green-500 focus:border-green-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed ${
            hasError 
              ? 'border-red-400 bg-red-50 focus:ring-red-500 focus:border-red-500' 
              : localValue !== '' 
                ? 'border-gray-300 bg-white' 
                : 'border-gray-200 bg-gray-50'
          } ${className}`}
          value={localValue}
          placeholder={placeholder}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={(e) => {
            if (autoSelect) {
              e.target.select();
            }
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 leading-none text-gray-400 text-sm font-medium">
            {suffix}
          </span>
        )}
      </div>
      {hasError && errorMessage && (
        <p className="mt-1 text-xs text-red-500">{errorMessage}</p>
      )}
    </div>
  );
};
