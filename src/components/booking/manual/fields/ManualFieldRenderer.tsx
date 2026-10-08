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
  Palmtree,
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
import {
  presentFieldLabel,
  presentOption,
  resolveFieldControl,
  resolveFieldPresentation,
  type ManualFieldPresentation,
} from '../presentation/manualEntryPresentation';
import { HelpDisclosure } from '../ui/HelpDisclosure';
import { NumberField } from '../ui/NumberField';
import { OptionList } from '../ui/OptionList';
import { SegmentedChoice } from '../ui/SegmentedChoice';
import { Stepper } from '../ui/Stepper';
import { ToggleRow } from '../ui/ToggleRow';
import { manualFieldId } from '../ui/fieldIds';
import { Pictogram } from '../ui/Pictogram';

/**
 * Registro de los iconos Lucide que nombra el schema. Desde F3 la lista de opciones no pinta
 * iconos (no distinguían nada: el mismo brote era «césped», «normal» y «pequeño»); el registro
 * se mantiene para los servicios que añadan un pictograma con sentido en su fase y para el test
 * que comprueba que el schema no nombra iconos inexistentes.
 */
const ICONS: Record<string, LucideIcon> = {
  Axe, Bug, Check, Columns2, Droplets, FlaskConical, Flower2, Layers, Leaf, Microscope,
  Palmtree, Ruler, Scissors, Shield, ShieldCheck, Shrub, SprayCan, Sprout, Square,
  Trees, TreeDeciduous, TreePine, AlertTriangle, Wheat,
};

/** Names registered in the icon registry — exported for the schema↔registry guard test. */
export const MANUAL_ICON_NAMES = Object.keys(ICONS);

interface Props {
  field: ManualFieldDef;
  value: ManualFieldValue;
  answers: ManualAnswers;
  /** Mensaje de error ya redactado para el cliente (`formatManualFieldError`). */
  error?: string | null;
  /** Mostrar los errores (tras salir del campo o tras pulsar «Siguiente»). */
  showError?: boolean;
  fieldPresentation?: ManualFieldPresentation;
  onChange: (value: ManualFieldValue) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  /** Nombre del grupo visible encima de las opciones (pantallas con varias preguntas, F8). */
  showLabel?: boolean;
}

/**
 * Elige el control de cada campo según la presentación del servicio (SISTEMA-UX §6.4-6.7). Lo
 * que se guarda es siempre el mismo dato del schema, con la misma clave y el mismo tipo.
 */
export const ManualFieldRenderer: React.FC<Props> = ({
  field,
  value,
  answers,
  error,
  showError = Boolean(error),
  fieldPresentation: rawFieldPresentation,
  showLabel = false,
  onChange,
  onBlur,
  onEnter,
}) => {
  const fieldPresentation = resolveFieldPresentation(rawFieldPresentation, answers);
  const label = presentFieldLabel(field, fieldPresentation);
  const id = manualFieldId(field.key);
  const control = resolveFieldControl(field, fieldPresentation);
  const shownError = showError ? error ?? null : null;
  // D-03: el `example` del schema eran comparaciones (plaza de garaje, puerta, cama…) y ya no se
  // enseña. La ayuda solo si no repite la frase de apoyo de la pantalla (T-18).
  const help = !fieldPresentation?.hideHelp ? fieldPresentation?.helpText ?? field.help : undefined;
  const helpId = help ? `${id}-help` : undefined;
  const measureHelp = fieldPresentation?.measureHelp ? (
    <HelpDisclosure>{fieldPresentation.measureHelp}</HelpDisclosure>
  ) : null;
  const helpText = help ? (
    <p id={helpId} className="mt-2 text-sm leading-5 text-gray-600">
      {help}
    </p>
  ) : null;
  const unit = fieldPresentation?.unit?.(answers) ?? field.unit;
  const format = fieldPresentation?.numberFormat ?? (field.type === 'integer' ? 'quantity' : 'decimal');
  const feedback = fieldPresentation?.feedback?.(answers) ?? null;

  if (control === 'number') {
    return (
      <div>
        <NumberField
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          format={format}
          unit={unit}
          integer={field.type === 'integer'}
          error={error}
          showError={showError}
          helpId={helpId}
          onBlur={onBlur}
          onEnter={onEnter}
          feedback={feedback}
        />
        {helpText}
        {measureHelp}
      </div>
    );
  }

  if (control === 'stepper') {
    return (
      <div>
        <Stepper
          id={id}
          label={label}
          value={value}
          onChange={onChange}
          min={field.min}
          max={field.max}
          step={field.step || 1}
          format={format}
          unit={unit}
          integer={field.type === 'integer'}
          error={error}
          showError={showError}
          helpId={helpId}
          onBlur={onBlur}
          onEnter={onEnter}
          feedback={feedback}
        />
        {helpText}
        {measureHelp}
      </div>
    );
  }

  if (control === 'toggle') {
    return (
      <ToggleRow
        id={id}
        label={label}
        help={help}
        badge={fieldPresentation?.badge}
        checked={value === true}
        onChange={(checked) => onChange(checked)}
      />
    );
  }

  const options = field.type === 'boolean' ? field.options || [] : getFieldOptions(field, answers);
  const selected = field.type === 'boolean' ? (value === true ? 'true' : value === false ? 'false' : '') : typeof value === 'string' ? value : '';
  const select = (next: string) => onChange(field.type === 'boolean' ? next === 'true' : next);

  if (control === 'segmented') {
    return (
      <SegmentedChoice
        id={id}
        label={label}
        options={options.map((option) => ({ value: option.value, label: presentOption(option, fieldPresentation).label }))}
        selected={selected}
        onSelect={select}
        help={help}
        feedback={feedback}
        error={shownError}
        showLabel={showLabel}
      />
    );
  }

  return (
    <div>
      <OptionList
        id={id}
        label={label}
        options={options.map((option) => {
          const pictogram = fieldPresentation?.optionPictograms?.[option.value];
          const image = fieldPresentation?.optionImages?.[option.value];
          const shown = presentOption(option, fieldPresentation);
          // Foto decorativa (`alt=""`): la etiqueta ya nombra la opción. Sin foto, sin hueco vacío.
          const media = pictogram ? (
            <Pictogram name={pictogram} />
          ) : image ? (
            <img src={image} alt="" width={56} height={56} loading="lazy" className="h-14 w-14 rounded-lg object-cover" />
          ) : undefined;
          return { value: option.value, label: shown.label, help: shown.help, media };
        })}
        selected={selected}
        onSelect={select}
        error={shownError}
        showLabel={showLabel}
      />
      {helpText}
    </div>
  );
};
