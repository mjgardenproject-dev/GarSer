import React, { useId } from 'react';
import { Camera, PencilLine, Sparkles } from 'lucide-react';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';

export type DataInputMode = 'photos' | 'manual';

interface Props {
  /** Modo elegido para este servicio; `null` mientras el cliente aún no ha elegido. */
  mode: DataInputMode | null;
  onSelect: (mode: DataInputMode) => void;
}

const S = MANUAL_ENTRY_STRINGS.choice;

/**
 * Cómo dará el cliente los datos del servicio: con fotos o escribiéndolos.
 *
 * Es un solo componente con dos presentaciones de los MISMOS dos botones, para que el paso de
 * una a otra sea una transición y no un cambio de pantalla:
 * - Sin elegir: dos tarjetas grandes con su explicación, y nada más debajo.
 * - Elegido: una barra compacta arriba (control segmentado) con la opción elegida resaltada y la
 *   otra visible y seleccionable. Es igual en los dos modos; antes el modo a mano se plegaba a
 *   una línea de texto y el de fotos seguía con las tarjetas grandes.
 *
 * Las partes que sobran en la barra (título de la pregunta, explicaciones, insignia) se pliegan
 * animando la altura (`grid-template-rows` 1fr → 0fr) y la opacidad; con «reducir movimiento»
 * activado el cambio es inmediato.
 */
export const ManualEntryChoice: React.FC<Props> = ({ mode, onSelect }) => {
  const headingId = useId();
  const compact = mode !== null;

  return (
    <section aria-labelledby={headingId} className={compact ? 'mb-4' : 'mb-5'}>
      <Collapsible open={!compact} keepAccessible>
        {/* Sigue siendo un h2 por semántica, pero con peso visual de apoyo: el encabezado
            principal del pliegue es la tarea del servicio, no esta decisión secundaria. Plegado
            sigue nombrando el grupo para los lectores de pantalla. */}
        <h2 id={headingId} className="mb-2 text-sm font-semibold text-gray-700">
          {S.heading}
        </h2>
      </Collapsible>

      <div
        role="radiogroup"
        aria-labelledby={headingId}
        className={`grid grid-cols-2 rounded-xl transition-all duration-300 ease-out motion-reduce:transition-none ${
          compact ? 'gap-1 bg-gray-100 p-1' : 'gap-2 bg-transparent p-0'
        }`}
      >
        <OptionCard
          compact={compact}
          selected={mode === 'photos'}
          onClick={() => onSelect('photos')}
          icon={<Camera className="h-4 w-4" aria-hidden />}
          title={S.photo.title}
          description={S.photo.description}
          badge={S.photo.badge}
        />
        <OptionCard
          compact={compact}
          selected={mode === 'manual'}
          onClick={() => onSelect('manual')}
          icon={<PencilLine className="h-4 w-4" aria-hidden />}
          title={S.manual.title}
          description={S.manual.description}
        />
      </div>

      <Collapsible open={!compact}>
        <p className="mt-2 text-xs text-gray-500">{S.subheading}</p>
      </Collapsible>
    </section>
  );
};

/**
 * Pliega su contenido animando la altura. Plegado, los lectores de pantalla tampoco lo leen,
 * salvo con `keepAccessible` (el título del grupo, que sigue nombrándolo).
 */
const Collapsible: React.FC<{ open: boolean; keepAccessible?: boolean; children: React.ReactNode }> = ({
  open,
  keepAccessible = false,
  children,
}) => (
  <div
    aria-hidden={!open && !keepAccessible ? true : undefined}
    className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none ${
      open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
    }`}
  >
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>
);

interface OptionCardProps {
  compact: boolean;
  selected: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
}

const OptionCard: React.FC<OptionCardProps> = ({ compact, selected, onClick, icon, title, description, badge }) => {
  const titleId = useId();
  const descriptionId = useId();

  const surface = compact
    ? selected
      ? 'border-green-500 bg-white shadow-sm ring-1 ring-green-500'
      : 'border-transparent bg-transparent hover:bg-white/70'
    : selected
      ? 'border-green-500 bg-green-50 shadow-sm ring-1 ring-green-500'
      : 'border-gray-200 bg-white hover:border-green-300 hover:bg-gray-50';

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      // El nombre es solo el título, igual plegado o no; la explicación va como descripción.
      aria-labelledby={titleId}
      aria-describedby={compact ? undefined : descriptionId}
      onClick={onClick}
      className={`min-h-[44px] rounded-xl border text-left transition-all duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 motion-reduce:transition-none [touch-action:manipulation] ${
        compact ? 'px-2 py-2' : 'p-3'
      } ${surface}`}
    >
      {/* Icono en línea con el título: apilarlos costaba ~40px de alto por tarjeta en el
          primer pliegue del móvil sin aportar información. Plegada, cada opción cabe en una
          línea a 375 px; la elegida se distingue por el fondo blanco, el borde verde y el icono
          relleno, no solo por el color del texto. */}
      <div className={`flex items-center ${compact ? 'justify-center gap-1.5' : 'gap-2'}`}>
        <span
          className={`flex shrink-0 items-center justify-center rounded-lg transition-all duration-300 motion-reduce:transition-none ${
            compact ? 'h-5 w-5' : 'h-7 w-7'
          } ${selected ? 'bg-emerald-700 text-white' : compact ? 'bg-white text-gray-600' : 'bg-gray-100 text-gray-600'}`}
        >
          {icon}
        </span>
        <span
          id={titleId}
          className={`font-bold leading-tight ${compact ? 'text-[13px]' : 'text-sm'} ${
            selected ? 'text-green-800' : compact ? 'text-gray-600' : 'text-gray-900'
          }`}
        >
          {title}
        </span>
      </div>
      <Collapsible open={!compact}>
        <div id={descriptionId}>
          <p className="mt-1.5 text-xs leading-snug text-gray-500">{description}</p>
          {badge && (
            <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
              <Sparkles className="h-2.5 w-2.5" aria-hidden />
              {badge}
            </span>
          )}
        </div>
      </Collapsible>
    </button>
  );
};
