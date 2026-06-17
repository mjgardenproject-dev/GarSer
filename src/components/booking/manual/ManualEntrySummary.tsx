import React from 'react';
import { Pencil } from 'lucide-react';
import {
  getFieldOptions,
  getVisibleFields,
  MANUAL_GLOBAL_WASTE_FIELD,
  type ManualAnswers,
  type ManualServiceSurvey,
} from '../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';

interface Props {
  survey: ManualServiceSurvey;
  items: ManualAnswers[];
  wasteRemoval: boolean;
  onEditItem: (itemIndex: number) => void;
}

const S = MANUAL_ENTRY_STRINGS.summary;

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

export const ManualEntrySummary: React.FC<Props> = ({ survey, items, wasteRemoval, onEditItem }) => {
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
    </div>
  );
};
