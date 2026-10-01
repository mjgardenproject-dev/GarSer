import React from 'react';
import {
  MANUAL_GLOBAL_WASTE_FIELD,
  serviceAsksForWasteRemoval,
  type ManualAnswers,
  type ManualServiceSurvey,
} from '../../../shared/manualEntry/manualEntrySchema';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';
import { formatManualValue } from './presentation/formatManualValue';
import { firstIncompleteScreenIndex, manualItemTitle } from './presentation/items';
import { getManualPresentation } from './presentation/manualEntryPresentation';
import { getVisibleScreens } from './presentation/screens';
import { ConsentRow } from './ui/ConsentRow';
import { ReviewList, type ReviewSection } from './ui/ReviewList';

interface Props {
  survey: ManualServiceSurvey;
  items: ManualAnswers[];
  wasteRemoval: boolean;
  /** «Cambiar» de una fila: el elemento y la pantalla (de sus pantallas visibles) a la que ir. */
  onChangeAnswer: (itemIndex: number, screenIndex: number) => void;
  onChangeWaste: () => void;
  /** Solo en formularios repetibles con más de un elemento. */
  onRemoveItem?: (itemIndex: number) => void;
  /**
   * Declaración de veracidad. Vivía en una pantalla propia al final del asistente: un paso
   * entero para decir algo que cabe en una frase, y encima separado de los datos a los que se
   * refiere. Aquí se lee y se acepta mirando lo que se está aceptando.
   */
  requireConsent?: boolean;
  consentChecked?: boolean;
  onConsentChange?: (checked: boolean) => void;
  /** El asistente pinta el título con su cabecera común; fuera de él, lo pinta el resumen. */
  showHeading?: boolean;
}

const S = MANUAL_ENTRY_STRINGS.summary;

export const ManualEntrySummary: React.FC<Props> = ({
  survey,
  items,
  wasteRemoval,
  onChangeAnswer,
  onChangeWaste,
  onRemoveItem,
  requireConsent = false,
  consentChecked = false,
  onConsentChange,
  showHeading = true,
}) => {
  const presentation = getManualPresentation(survey.serviceKey);

  const sections: ReviewSection[] = items.map((item, itemIndex) => {
    const screens = getVisibleScreens(survey, presentation, item);
    const incompleteAt = firstIncompleteScreenIndex(survey, presentation, item);
    return {
      key: `item-${itemIndex}`,
      title: survey.repeatable ? manualItemTitle(survey, itemIndex) : undefined,
      isItem: true,
      incomplete: incompleteAt !== -1,
      onComplete: incompleteAt !== -1 ? () => onChangeAnswer(itemIndex, incompleteAt) : undefined,
      onRemove: survey.repeatable && items.length > 1 && onRemoveItem ? () => onRemoveItem(itemIndex) : undefined,
      rows: screens.flatMap((screen, screenIndex) =>
        screen.fields.map((field) => ({
          key: `${itemIndex}-${field.key}`,
          label: field.label,
          value: formatManualValue(field, item, presentation.fields[field.key]),
          onChange: () => onChangeAnswer(itemIndex, screenIndex),
        })),
      ),
    };
  });

  // Los servicios que no facturan retirada tampoco la resumen: mostrar «Retirada de restos: Sí»
  // en un tratamiento fitosanitario prometía algo que nadie cobraba.
  if (serviceAsksForWasteRemoval(survey.serviceKey)) {
    sections.push({
      key: 'waste',
      rows: [
        {
          key: 'waste',
          label: MANUAL_GLOBAL_WASTE_FIELD.label,
          value: wasteRemoval ? MANUAL_ENTRY_STRINGS.waste.yes.label : MANUAL_ENTRY_STRINGS.waste.no.label,
          onChange: onChangeWaste,
        },
      ],
    });
  }

  return (
    <div className="space-y-4">
      {showHeading ? (
        <div>
          <h3 className="text-lg font-bold text-gray-900">{S.title}</h3>
          <p className="text-sm text-gray-500 mt-1">{S.subtitle}</p>
        </div>
      ) : null}
      <ReviewList sections={sections} />
      {requireConsent ? <ConsentRow checked={consentChecked} onChange={(checked) => onConsentChange?.(checked)} /> : null}
    </div>
  );
};
