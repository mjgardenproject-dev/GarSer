import React from 'react';
import { AlertCircle } from 'lucide-react';
import { MANUAL_ENTRY_STRINGS } from '../../../../shared/manualEntry/strings';

export interface ReviewRow {
  key: string;
  label: string;
  value: string;
  onChange: () => void;
}

export interface ReviewSection {
  key: string;
  /** Solo en los formularios repetibles («Árbol 1»). */
  title?: string;
  /** Sección de un elemento declarado (las cuentan las pruebas del fantasma). */
  isItem?: boolean;
  incomplete?: boolean;
  onComplete?: () => void;
  onRemove?: () => void;
  rows: ReviewRow[];
}

const W = MANUAL_ENTRY_STRINGS.wizard;

/**
 * Revisión de lo declarado (SISTEMA-UX §6.13, patrón «revisar respuestas»): cada dato con su
 * valor en español («2,3 m», «Acceso normal») y un «Cambiar» que lleva a esa pregunta y vuelve
 * aquí. Antes «Editar» devolvía al principio del elemento y había que repasarlo entero.
 */
export const ReviewList: React.FC<{ sections: ReviewSection[] }> = ({ sections }) => (
  <div className="space-y-3">
    {sections.map((section) => (
      <section
        key={section.key}
        data-manual-review-item={section.isItem ? '' : undefined}
        aria-label={section.title}
        className={`rounded-xl border bg-white ${section.incomplete ? 'border-amber-300' : 'border-gray-200'}`}
      >
        {section.title ? (
          <div className="flex items-center justify-between gap-3 px-4 pt-3">
            <h3 className="text-base font-semibold text-gray-900">{section.title}</h3>
            {section.onRemove ? (
              <button
                type="button"
                onClick={section.onRemove}
                aria-label={`${W.remove} ${section.title.toLowerCase()}`}
                className="-mr-3 inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                {W.remove}
              </button>
            ) : null}
          </div>
        ) : null}
        {section.incomplete ? (
          <div className="mx-4 mt-2 flex items-center justify-between gap-3 rounded-lg bg-amber-50 py-1 pl-3 pr-1">
            <p className="flex items-center gap-1.5 text-sm font-medium text-amber-900">
              <AlertCircle className="h-4 w-4" aria-hidden />
              {W.missingData}
            </p>
            {section.onComplete ? (
              <button
                type="button"
                onClick={section.onComplete}
                className="inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                {W.complete}
              </button>
            ) : null}
          </div>
        ) : null}
        <dl className="divide-y divide-gray-100 px-4">
          {section.rows.map((row) => (
            <div key={row.key} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <dt className="text-sm text-gray-600">{row.label}</dt>
                <dd className="mt-0.5 text-base font-semibold text-gray-900">{row.value}</dd>
              </div>
              <button
                type="button"
                onClick={row.onChange}
                aria-label={`${W.change} ${row.label.toLowerCase()}`}
                className="-mr-3 inline-flex min-h-[44px] shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
              >
                {W.change}
              </button>
            </div>
          ))}
        </dl>
      </section>
    ))}
  </div>
);
