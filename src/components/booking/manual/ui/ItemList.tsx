import React from 'react';
import { AlertCircle } from 'lucide-react';
import { MANUAL_ENTRY_STRINGS } from '../../../../shared/manualEntry/strings';

export interface ItemListEntry {
  title: string;
  summary: string;
  incomplete: boolean;
}

interface Props {
  items: ItemListEntry[];
  onEdit: (index: number) => void;
  /** Sin esta función (o con un solo elemento) no se ofrece eliminar. */
  onRemove?: (index: number) => void;
}

const W = MANUAL_ENTRY_STRINGS.wizard;
const ACTION =
  'inline-flex min-h-[44px] items-center rounded-lg px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]';

/**
 * Lo que lleva añadido el cliente en un formulario repetible (SISTEMA-UX §6.12): cada elemento con
 * su resumen, «Editar» y «Eliminar». Antes la pantalla solo decía «Has añadido 2 árbols» y no
 * dejaba quitar ninguno.
 */
export const ItemList: React.FC<Props> = ({ items, onEdit, onRemove }) => (
  <ul className="space-y-2">
    {items.map((item, index) => (
      <li key={index} data-manual-item className="rounded-xl border border-gray-200 bg-white px-4 py-3">
        <p className="text-base font-semibold text-gray-900">{item.title}</p>
        {item.summary ? <p className="mt-0.5 text-sm leading-5 text-gray-600">{item.summary}</p> : null}
        {item.incomplete ? (
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-amber-800">
            <AlertCircle className="h-4 w-4" aria-hidden />
            {W.missingData}
          </p>
        ) : null}
        <div className="-mx-3 mt-1 flex justify-between">
          <button
            type="button"
            onClick={() => onEdit(index)}
            aria-label={`${item.incomplete ? W.complete : W.edit} ${item.title.toLowerCase()}`}
            className={`${ACTION} text-emerald-700`}
          >
            {item.incomplete ? W.complete : W.edit}
          </button>
          {onRemove && items.length > 1 ? (
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`${W.remove} ${item.title.toLowerCase()}`}
              className={`${ACTION} text-red-700`}
            >
              {W.remove}
            </button>
          ) : null}
        </div>
      </li>
    ))}
  </ul>
);
