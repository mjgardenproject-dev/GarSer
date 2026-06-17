import React from 'react';
import {
  Axe,
  Bug,
  Check,
  Columns2,
  Droplets,
  FlaskConical,
  Flower2,
  Layers,
  Leaf,
  Microscope,
  Minus,
  Palmtree,
  Plus,
  Ruler,
  Scissors,
  Shield,
  ShieldCheck,
  Shrub,
  SprayCan,
  Sprout,
  Square,
  Trees,
  TreeDeciduous,
  TreePine,
  AlertTriangle,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import {
  getFieldOptions,
  type ManualAnswers,
  type ManualFieldDef,
  type ManualFieldValue,
} from '../../../../shared/manualEntry/manualEntrySchema';

const ICONS: Record<string, LucideIcon> = {
  Axe, Bug, Check, Columns2, Droplets, FlaskConical, Flower2, Layers, Leaf, Microscope,
  Palmtree, Ruler, Scissors, Shield, ShieldCheck, Shrub, SprayCan, Sprout, Square,
  Trees, TreeDeciduous, TreePine, AlertTriangle, Wheat,
};

/** Names registered in the icon registry — exported for the schema↔registry guard test. */
export const MANUAL_ICON_NAMES = Object.keys(ICONS);

const resolveIcon = (name?: string): LucideIcon | null => (name && ICONS[name]) || null;

interface Props {
  field: ManualFieldDef;
  value: ManualFieldValue;
  answers: ManualAnswers;
  error?: string | null;
  onChange: (value: ManualFieldValue) => void;
}

const clamp = (value: number, min?: number, max?: number) => {
  let next = value;
  if (typeof min === 'number') next = Math.max(min, next);
  if (typeof max === 'number') next = Math.min(max, next);
  return next;
};

export const ManualFieldRenderer: React.FC<Props> = ({ field, value, answers, error, onChange }) => {
  const helpId = `${field.key}-help`;
  const describedBy = field.help || field.example || error ? helpId : undefined;

  const HelpBlock = () => (
    <div id={helpId} className="mt-2 space-y-1">
      {field.help && <p className="text-sm text-gray-500 leading-relaxed">{field.help}</p>}
      {field.example && (
        <p className="text-xs text-gray-400 leading-relaxed flex items-start gap-1">
          <Ruler aria-hidden className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{field.example}</span>
        </p>
      )}
      {error && <p className="text-sm text-red-600 font-medium" role="alert">{error}</p>}
    </div>
  );

  /* ----- Stepper (numbers / integers) ----- */
  if (field.ui === 'stepper') {
    const step = field.step || 1;
    const current = typeof value === 'number' ? value : (typeof field.defaultValue === 'number' ? field.defaultValue : field.min ?? 0);
    return (
      <div>
        <div className="flex items-center justify-center gap-4">
          <button
            type="button"
            aria-label={`Disminuir ${field.label.toLowerCase()}`}
            onClick={() => onChange(clamp(Number(current) - step, field.min, field.max))}
            className="w-12 h-12 rounded-full border border-gray-200 bg-white text-gray-700 flex items-center justify-center hover:bg-gray-50 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <Minus className="w-5 h-5" />
          </button>
          <div className="min-w-[6rem] text-center">
            <input
              type="number"
              inputMode="decimal"
              aria-label={field.label}
              aria-describedby={describedBy}
              value={typeof value === 'number' ? value : ''}
              min={field.min}
              max={field.max}
              step={step}
              onChange={(event) => {
                const raw = event.target.value;
                onChange(raw === '' ? undefined : Number(raw));
              }}
              className="w-24 text-center text-3xl font-bold text-gray-900 bg-transparent focus:outline-none"
            />
            {field.unit && <div className="text-xs text-gray-500 mt-1">{field.unit}</div>}
          </div>
          <button
            type="button"
            aria-label={`Aumentar ${field.label.toLowerCase()}`}
            onClick={() => onChange(clamp(Number(current) + step, field.min, field.max))}
            className="w-12 h-12 rounded-full border border-gray-200 bg-white text-gray-700 flex items-center justify-center hover:bg-gray-50 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
        <HelpBlock />
      </div>
    );
  }

  /* ----- Slider (numbers) ----- */
  if (field.ui === 'slider') {
    const step = field.step || 1;
    const min = field.min ?? 0;
    const max = field.max ?? 100;
    const current = typeof value === 'number' ? value : min;
    return (
      <div>
        <div className="flex items-baseline justify-center gap-2 mb-4">
          <input
            type="number"
            inputMode="decimal"
            aria-label={field.label}
            aria-describedby={describedBy}
            value={typeof value === 'number' ? value : ''}
            min={min}
            max={max}
            step={step}
            onChange={(event) => {
              const raw = event.target.value;
              onChange(raw === '' ? undefined : Number(raw));
            }}
            className="w-28 text-center text-3xl font-bold text-gray-900 border-b-2 border-green-500 bg-transparent focus:outline-none"
          />
          {field.unit && <span className="text-lg text-gray-500">{field.unit}</span>}
        </div>
        <input
          type="range"
          aria-label={`${field.label} (control deslizante)`}
          min={min}
          max={max}
          step={step}
          value={current}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full h-2 accent-green-600 cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>{min}{field.unit ? ` ${field.unit}` : ''}</span>
          <span>{max}{field.unit ? ` ${field.unit}` : ''}</span>
        </div>
        <HelpBlock />
      </div>
    );
  }

  /* ----- Toggle (boolean) ----- */
  if (field.ui === 'toggle') {
    const checked = value === true;
    return (
      <div className="flex items-start justify-between gap-4 bg-white border border-gray-200 rounded-xl p-4">
        <div>
          <p className="font-medium text-gray-900">{field.label}</p>
          {field.help && <p className="text-sm text-gray-500 mt-1 leading-relaxed">{field.help}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-label={field.label}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${checked ? 'bg-green-600' : 'bg-gray-200'}`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>
    );
  }

  /* ----- Cards (enum + boolean-as-cards) ----- */
  const options = field.type === 'boolean'
    ? (field.options || [])
    : getFieldOptions(field, answers);
  const selectedValue = field.type === 'boolean'
    ? (value === true ? 'true' : value === false ? 'false' : '')
    : (typeof value === 'string' ? value : '');

  return (
    <div role="radiogroup" aria-label={field.label}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((option) => {
          const Icon = resolveIcon(option.icon);
          const isSelected = selectedValue === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(field.type === 'boolean' ? option.value === 'true' : option.value)}
              className={`text-left p-4 rounded-xl border transition min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${
                isSelected
                  ? 'bg-green-50 border-green-500 ring-1 ring-green-500 shadow-sm'
                  : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-3">
                {Icon && (
                  <span className={`mt-0.5 ${isSelected ? 'text-green-600' : 'text-gray-400'}`}>
                    <Icon className="w-5 h-5" aria-hidden />
                  </span>
                )}
                <span className="flex-1">
                  <span className={`block font-medium ${isSelected ? 'text-green-800' : 'text-gray-900'}`}>{option.label}</span>
                  {option.help && <span className="block text-sm text-gray-500 mt-0.5 leading-relaxed">{option.help}</span>}
                </span>
                {isSelected && <Check className="w-5 h-5 text-green-600 shrink-0" aria-hidden />}
              </div>
            </button>
          );
        })}
      </div>
      <HelpBlock />
    </div>
  );
};
