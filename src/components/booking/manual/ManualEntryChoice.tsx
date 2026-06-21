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
    <section aria-label={S.heading} className="mb-6">
      <h2 className="text-lg font-bold text-gray-900">{S.heading}</h2>
      <p className="text-sm text-gray-500 mt-1 mb-4 leading-relaxed">{S.subheading}</p>

      <div className="grid grid-cols-2 gap-3">
        <OptionCard
          selected={mode === 'photos'}
          onClick={() => onSelect('photos')}
          icon={<Camera className="w-5 h-5" aria-hidden />}
          title={S.photo.title}
          description={S.photo.description}
          badge={S.photo.badge}
        />
        <OptionCard
          selected={mode === 'manual'}
          onClick={() => onSelect('manual')}
          icon={<PencilLine className="w-5 h-5" aria-hidden />}
          title={S.manual.title}
          description={S.manual.description}
        />
      </div>
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
    className={`relative text-left p-4 rounded-2xl border transition min-h-[44px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 ${
      selected
        ? 'bg-green-50 border-green-500 ring-1 ring-green-500 shadow-sm'
        : 'bg-white border-gray-200 hover:border-green-300 hover:bg-gray-50'
    }`}
  >
    {badge && (
      <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
        <Sparkles className="w-3 h-3" aria-hidden />
        {badge}
      </span>
    )}
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 ${selected ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
      {icon}
    </div>
    <div className="flex items-center gap-2">
      <h3 className={`font-bold ${selected ? 'text-green-800' : 'text-gray-900'}`}>{title}</h3>
      {selected && <Check className="w-4 h-4 text-green-600" aria-hidden />}
    </div>
    <p className="text-sm text-gray-500 mt-1 leading-relaxed">{description}</p>
  </button>
);
