import React from 'react';
import { Camera, PencilLine, Sparkles, Check } from 'lucide-react';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';

export type DataInputMode = 'photos' | 'manual';

interface Props {
  mode: DataInputMode;
  onSelect: (mode: DataInputMode) => void;
}

const S = MANUAL_ENTRY_STRINGS.choice;

/**
 * Two equally-weighted options presented at the top of the per-service section.
 * Photos stays the suggested default; manual is a first-class alternative, not a
 * hidden or degraded mode.
 */
export const ManualEntryChoice: React.FC<Props> = ({ mode, onSelect }) => {
  return (
    <section aria-label={S.heading} className="mb-5">
      {/* Sigue siendo un h2 por semántica, pero con peso visual de apoyo: el encabezado
          principal del pliegue es la tarea del servicio, no esta decisión secundaria. */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">{S.heading}</h2>

      <div className="grid grid-cols-2 gap-2">
        <OptionCard
          selected={mode === 'photos'}
          onClick={() => onSelect('photos')}
          icon={<Camera className="w-4 h-4" aria-hidden />}
          title={S.photo.title}
          description={S.photo.description}
          badge={S.photo.badge}
        />
        <OptionCard
          selected={mode === 'manual'}
          onClick={() => onSelect('manual')}
          icon={<PencilLine className="w-4 h-4" aria-hidden />}
          title={S.manual.title}
          description={S.manual.description}
        />
      </div>

      <p className="text-xs text-gray-500 mt-2">{S.subheading}</p>
    </section>
  );
};

interface OptionCardProps {
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}

const OptionCard: React.FC<OptionCardProps> = ({ selected, onClick, icon, title, description, badge }) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onClick}
    className={`text-left p-3 rounded-xl border transition min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation] ${
      selected
        ? 'bg-green-50 border-green-500 ring-1 ring-green-500 shadow-sm'
        : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
    }`}
  >
    {/* Icono en línea con el título: apilarlos costaba ~40px de alto por tarjeta en el
        primer pliegue del móvil sin aportar información. */}
    <div className="flex items-center gap-2">
      <span
        className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${
          selected ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600'
        }`}
      >
        {icon}
      </span>
      <h3 className={`text-sm font-bold leading-tight ${selected ? 'text-green-800' : 'text-gray-900'}`}>{title}</h3>
      {selected && <Check className="w-4 h-4 shrink-0 text-green-600" aria-hidden />}
    </div>
    <p className="text-xs text-gray-500 mt-1.5 leading-snug">{description}</p>
    {badge && (
      <span className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
        <Sparkles className="w-2.5 h-2.5" aria-hidden />
        {badge}
      </span>
    )}
  </button>
);
