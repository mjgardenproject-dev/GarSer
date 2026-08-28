import React from 'react';
import { Pencil, ShieldCheck } from 'lucide-react';
import {
  getFieldOptions,
  getVisibleFields,
  MANUAL_GLOBAL_WASTE_FIELD,
  type ManualAnswers,
  type ManualServiceSurvey,
} from '../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_ENTRY_CONSENT_TEXT } from '../../../shared/manualEntry/legalCopy';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';

interface Props {
  survey: ManualServiceSurvey;
  items: ManualAnswers[];
  wasteRemoval: boolean;
  onEditItem: (itemIndex: number) => void;
  /**
   * Declaración de veracidad. Vivía en una pantalla propia al final del asistente: un paso
   * entero para decir algo que cabe en una frase, y encima separado de los datos a los que se
   * refiere. Aquí se lee y se acepta mirando lo que se está aceptando.
   */
  requireConsent?: boolean;
  consentChecked?: boolean;
  onConsentChange?: (checked: boolean) => void;
}

const S = MANUAL_ENTRY_STRINGS.summary;
const C = MANUAL_ENTRY_STRINGS.consent;

function formatValue(field: ReturnType<typeof getVisibleFields>[number], answers: ManualAnswers): string {
  const value = answers[field.key];
  if (field.type === 'boolean') return value === true ? 'Sí' : 'No';
  if (field.type === 'enum') {
    const option = getFieldOptions(field, answers).find((o) => o.value === value);
    return option?.label || String(value ?? '—');
  }
  if (value === undefined || value === null || value === '') return '—';
  return `${value}${field.unit ? ` ${field.unit}` : ''}`;
}

export const ManualEntrySummary: React.FC<Props> = ({
  survey,
  items,
  wasteRemoval,
  onEditItem,
  requireConsent = false,
  consentChecked = false,
  onConsentChange,
}) => {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-gray-900">{S.title}</h3>
        <p className="text-sm text-gray-500 mt-1">{S.subtitle}</p>
      </div>

      {items.map((item, index) => {
        const rows = survey.steps.flatMap((step) =>
          getVisibleFields(step, item).map((field) => ({
            key: `${index}-${field.key}`,
            label: field.label,
            value: formatValue(field, item),
          })),
        );
        return (
          <div key={index} className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-900">
                {survey.repeatable ? S.itemLabel(survey.itemNoun, index) : `Datos de ${survey.itemNoun}`}
              </h4>
              <button
                type="button"
                onClick={() => onEditItem(index)}
                className="inline-flex items-center gap-1 text-sm font-medium text-green-700 hover:text-green-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded px-2 py-1"
              >
                <Pencil className="w-4 h-4" aria-hidden />
                {MANUAL_ENTRY_STRINGS.wizard.edit}
              </button>
            </div>
            <dl className="divide-y divide-gray-100">
              {rows.map((row) => (
                <div key={row.key} className="flex justify-between gap-4 py-2">
                  <dt className="text-sm text-gray-500">{row.label}</dt>
                  <dd className="text-sm font-medium text-gray-900 text-right">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}

      <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex justify-between py-3">
        <span className="text-sm text-gray-500">{MANUAL_GLOBAL_WASTE_FIELD.label}</span>
        <span className="text-sm font-medium text-gray-900">{wasteRemoval ? 'Sí' : 'No'}</span>
      </div>

      {requireConsent && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentChecked}
              onChange={(event) => onConsentChange?.(event.target.checked)}
              aria-label={C.checkboxAriaLabel}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-green-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            />
            <span className="flex-1 text-sm leading-relaxed text-gray-700">
              <ShieldCheck className="inline w-4 h-4 text-green-600 mr-1 -mt-0.5" aria-hidden />
              {C.shortLabel}
            </span>
          </label>

          {/* El texto que se REGISTRA sigue siendo el íntegro, así que tiene que estar en esta
              misma pantalla y no a un enlace de distancia: plegado, pero presente. */}
          <details className="mt-3">
            <summary className="cursor-pointer rounded text-xs font-medium text-gray-500 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
              {C.fullTextToggle}
            </summary>
            <p className="mt-2 text-xs leading-relaxed text-gray-500">{MANUAL_ENTRY_CONSENT_TEXT}</p>
          </details>
        </div>
      )}
    </div>
  );
};
