import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Plus } from 'lucide-react';
import {
  MANUAL_GLOBAL_WASTE_FIELD,
  MANUAL_GLOBAL_WASTE_STEP,
  serviceAsksForWasteRemoval,
  type ManualAnswers,
  type ManualServiceSurvey,
} from '../../../shared/manualEntry/manualEntrySchema';
import { validateManualField } from '../../../shared/manualEntry/manualEntryValidation';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';
import { useConfirmDialog } from '../../common/ConfirmDialog';
import { ManualFieldRenderer } from './fields/ManualFieldRenderer';
import { manualFieldId } from './ui/fieldIds';
import { ManualEntrySummary } from './ManualEntrySummary';
import { formatManualFieldError } from './presentation/fieldErrors';
import {
  createEmptyManualItem,
  firstIncompleteScreenIndex,
  isManualItemEmpty,
  manualItemCount,
  manualItemTitle,
  summarizeManualItem,
} from './presentation/items';
import { getManualPresentation } from './presentation/manualEntryPresentation';
import { getQuestionProgress, getVisibleScreens } from './presentation/screens';
import { HelpDisclosure } from './ui/HelpDisclosure';
import { ItemList } from './ui/ItemList';
import { ManualStepHeader } from './ui/ManualStepHeader';
import { OptionList } from './ui/OptionList';
import { WizardFooter } from './ui/WizardFooter';

// La fase 'consent' se retiró: ocupaba una pantalla entera al final para una sola frase, y
// además separaba la declaración de veracidad de los datos a los que se refiere. Ahora se
// acepta dentro del propio resumen, mirando lo que se acepta.
type WizardPhase = 'item' | 'interstitial' | 'waste' | 'summary';

export interface ManualWizardSubmitPayload {
  items: ManualAnswers[];
  wasteRemoval: boolean;
}

interface Props {
  survey: ManualServiceSurvey;
  submitting?: boolean;
  initialItems?: ManualAnswers[];
  /**
   * Fase de arranque. Al repetir un servicio las respuestas ya vienen dadas, así que empezar
   * por la primera pregunta obliga a recorrer la encuesta entera para no cambiar nada. Con
   * `'summary'` el cliente ve todos los apartados y edita solo el que haya cambiado.
   */
  initialPhase?: 'item' | 'summary';
  initialWasteRemoval?: boolean;
  /** When false, the legal-consent step is skipped (e.g. gardener on-site correction). */
  requireConsent?: boolean;
  /** Final action label when consent is not required. */
  submitLabel?: string;
  /** When false, the "switch to photos" affordance is hidden. */
  showSwitchToPhotos?: boolean;
  /**
   * Pie de navegación fijo abajo (página «Detalles»). Por defecto va en línea, que es lo que
   * necesita el modal de corrección del jardinero.
   */
  stickyFooter?: boolean;
  /**
   * Nombre del servicio en la cabecera de cada pregunta. La página lo apaga cuando ya lo dice
   * ella («Servicio 2 de 5: Poda de palmeras»), para no repetirlo.
   */
  showServiceName?: boolean;
  onDraftChange?: (payload: ManualWizardSubmitPayload) => void;
  onStepComplete?: (stepId: string) => void;
  onConsentAccepted?: () => void;
  onSubmit: (payload: ManualWizardSubmitPayload) => void;
  onSwitchToPhotos?: () => void;
}

const W = MANUAL_ENTRY_STRINGS.wizard;
const WASTE = MANUAL_ENTRY_STRINGS.waste;

export const ManualEntryWizard: React.FC<Props> = ({
  survey,
  submitting = false,
  initialItems,
  initialPhase = 'item',
  initialWasteRemoval,
  requireConsent = true,
  submitLabel,
  showSwitchToPhotos = true,
  stickyFooter = false,
  showServiceName = true,
  onDraftChange,
  onStepComplete,
  onConsentAccepted,
  onSubmit,
  onSwitchToPhotos,
}) => {
  const [items, setItems] = useState<ManualAnswers[]>(
    initialItems && initialItems.length > 0 ? initialItems : [createEmptyManualItem(survey)],
  );
  const [wasteRemoval, setWasteRemoval] = useState<boolean>(
    initialWasteRemoval ?? (MANUAL_GLOBAL_WASTE_FIELD.defaultValue === true),
  );
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [phase, setPhase] = useState<WizardPhase>(initialPhase);
  const [consentChecked, setConsentChecked] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  // Campos que el cliente ya ha dejado: su error se enseña al salir de ellos, no mientras
  // escribe ni dos pantallas después (Baymard). Se vacía al cambiar de pantalla.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  // Campo al que llevar el foco tras pulsar «Siguiente» con errores.
  const [focusErrorKey, setFocusErrorKey] = useState<string | null>(null);
  // Se llegó a la pregunta desde «Cambiar» en la revisión: al terminar, se vuelve a ella.
  const [returnToReview, setReturnToReview] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const activeItem = useMemo(() => items[activeItemIndex] || {}, [items, activeItemIndex]);
  const presentation = getManualPresentation(survey.serviceKey);
  // Pantallas visibles del elemento activo. La presentación decide qué pasos del schema
  // comparten pantalla.
  const visibleSteps = useMemo(
    () => getVisibleScreens(survey, presentation, activeItem),
    [survey, presentation, activeItem],
  );
  const currentStep = visibleSteps[activeStepIndex];

  useEffect(() => {
    onDraftChange?.({ items, wasteRemoval });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, wasteRemoval]);

  useEffect(() => {
    headingRef.current?.focus();
    setTouched(new Set());
  }, [phase, activeStepIndex, activeItemIndex]);

  // Al fallar, el foco va al primer campo con error, centrado en pantalla: en el móvil el error
  // podía quedar fuera de la vista y el cliente no sabía por qué no avanzaba (T-07).
  useEffect(() => {
    if (!focusErrorKey) return;
    const element = document.getElementById(manualFieldId(focusErrorKey));
    if (element) {
      element.focus({ preventScroll: true });
      element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    }
    setFocusErrorKey(null);
  }, [focusErrorKey]);

  const markTouched = (key: string) =>
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));

  const updateAnswer = (key: string, value: ManualAnswers[string]) => {
    setItems((prev) => {
      const next = [...prev];
      next[activeItemIndex] = { ...next[activeItemIndex], [key]: value };
      return next;
    });
  };

  // Qué falla lo decide la validación compartida (la misma del servidor); cómo se le dice al
  // cliente, la capa de presentación: con artículo, unidad y números en español.
  const currentStepErrors = useMemo(() => {
    if (phase !== 'item' || !currentStep) return [] as Array<{ field: string; message: string }>;
    return currentStep.fields
      .map((field) => {
        const error = validateManualField(field, activeItem[field.key], activeItem);
        return error
          ? { field: error.field, message: formatManualFieldError(error, field, activeItem[field.key], presentation.fields[field.key]) }
          : null;
      })
      .filter((error): error is { field: string; message: string } => Boolean(error));
  }, [phase, currentStep, activeItem, presentation]);

  const errorByField = useMemo(() => {
    const map: Record<string, string> = {};
    currentStepErrors.forEach((error) => {
      map[error.field] = error.message;
    });
    return map;
  }, [currentStepErrors]);

  // Hay servicios que no facturan retirada de restos (fitosanitarios: es una aplicación de
  // producto, no una poda). Preguntarla allí daba una respuesta que no cambiaba el precio
  // pero sí lo que el profesional leía en la solicitud.
  const asksWaste = serviceAsksForWasteRemoval(survey.serviceKey);

  // Primer elemento que no está completo (P-01): con él pendiente no se puede confirmar.
  const firstIncompleteItem = useMemo(
    () => items.findIndex((item) => firstIncompleteScreenIndex(survey, presentation, item) !== -1),
    [items, survey, presentation],
  );
  const activeItemComplete = firstIncompleteScreenIndex(survey, presentation, activeItem) === -1;

  // Un solo indicador de progreso en pantalla: la barra es la de la reserva («Paso 3 de 5») y
  // aquí solo se dice en qué pregunta se está. El total cuenta la retirada de restos y nunca
  // crece al responder. Con varios elementos, también cuál se está rellenando («Árbol 2»).
  const eyebrow = useMemo(() => {
    const service = showServiceName ? survey.serviceLabel : '';
    const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
    if (phase === 'summary') return join(service, W.reviewLabel);
    if (phase === 'interstitial') return service || undefined;
    const answers = phase === 'waste' ? items[items.length - 1] || {} : activeItem;
    const screenId = phase === 'waste' ? 'waste' : currentStep?.id ?? '';
    const progress = getQuestionProgress(survey, presentation, answers, screenId, { asksWaste });
    const itemLabel = phase === 'item' && survey.repeatable && items.length > 1 ? manualItemTitle(survey, activeItemIndex) : '';
    return join(service, itemLabel, W.questionProgress(progress.current, progress.total));
  }, [phase, showServiceName, survey, presentation, items, activeItem, activeItemIndex, currentStep, asksWaste]);

  const lastScreenIndexOf = (itemIndex: number) =>
    Math.max(0, getVisibleScreens(survey, presentation, items[itemIndex] || {}).length - 1);

  const goToItemScreen = (itemIndex: number, screenIndex: number) => {
    setActiveItemIndex(itemIndex);
    setActiveStepIndex(screenIndex);
    setShowErrors(false);
    setPhase('item');
  };

  const afterItem = () => setPhase(survey.repeatable ? 'interstitial' : asksWaste ? 'waste' : 'summary');

  const goNextFromItem = () => {
    if (currentStepErrors.length > 0) {
      setShowErrors(true);
      setFocusErrorKey(currentStepErrors[0].field);
      return;
    }
    setShowErrors(false);
    // Una pantalla puede reunir varios pasos: cada uno sigue emitiendo su `stepId`, en orden.
    currentStep?.stepIds.forEach((stepId) => onStepComplete?.(stepId));

    // Desde «Cambiar» en la revisión: si el elemento ya está completo, se vuelve a la revisión;
    // si el cambio ha abierto preguntas nuevas sin contestar (p. ej. otro tipo de vegetación),
    // se siguen hasta completarlo.
    if (returnToReview && activeItemComplete) {
      setReturnToReview(false);
      setPhase('summary');
      return;
    }
    if (activeStepIndex < visibleSteps.length - 1) {
      setActiveStepIndex((index) => index + 1);
      return;
    }
    if (returnToReview) {
      setReturnToReview(false);
      setPhase('summary');
      return;
    }
    afterItem();
  };

  // «Atrás» en la primera pregunta de un elemento que no es el único vuelve a la lista. Si el
  // elemento está vacío (se añadió y no se contestó nada), se descarta: es el arreglo de P-01.
  const canLeaveItemToList = survey.repeatable && items.length > 1;
  const showBackInItem = returnToReview || activeStepIndex > 0 || canLeaveItemToList;

  const goBack = () => {
    setShowErrors(false);
    if (returnToReview && (phase === 'item' || phase === 'waste')) {
      setReturnToReview(false);
      setPhase('summary');
      return;
    }
    if (phase === 'summary') {
      if (asksWaste) return setPhase('waste');
      if (survey.repeatable) return setPhase('interstitial');
      return goToItemScreen(items.length - 1, lastScreenIndexOf(items.length - 1));
    }
    if (phase === 'waste') {
      if (survey.repeatable) return setPhase('interstitial');
      return goToItemScreen(items.length - 1, lastScreenIndexOf(items.length - 1));
    }
    if (phase === 'interstitial') {
      return goToItemScreen(items.length - 1, lastScreenIndexOf(items.length - 1));
    }
    // phase === 'item'
    if (activeStepIndex > 0) {
      setActiveStepIndex((index) => index - 1);
      return;
    }
    if (canLeaveItemToList) {
      if (isManualItemEmpty(survey, activeItem)) {
        const discarded = activeItemIndex;
        setItems((prev) => prev.filter((_, index) => index !== discarded));
        setActiveItemIndex(0);
      }
      setPhase('interstitial');
    }
  };

  const addAnotherItem = () => {
    setItems((prev) => [...prev, createEmptyManualItem(survey)]);
    goToItemScreen(items.length, 0);
  };

  /** «Editar» / «Completar» desde la lista: a la primera pregunta que falte, o a la primera. */
  const editItemFromList = (itemIndex: number) => {
    setReturnToReview(false);
    goToItemScreen(itemIndex, Math.max(0, firstIncompleteScreenIndex(survey, presentation, items[itemIndex])));
  };

  /** «Cambiar» en la revisión: a esa pregunta, y de vuelta a la revisión al terminar. */
  const changeAnswer = (itemIndex: number, screenIndex: number) => {
    setReturnToReview(true);
    goToItemScreen(itemIndex, screenIndex);
  };

  const changeWaste = () => {
    setReturnToReview(true);
    setPhase('waste');
  };

  const removeItem = (itemIndex: number) => {
    const title = manualItemTitle(survey, itemIndex);
    openConfirm({
      title: W.removeConfirmTitle(title),
      message: W.removeConfirmMessage,
      confirmLabel: W.removeConfirmCta,
      cancelLabel: W.keepCta,
      tone: 'danger',
      onConfirm: () => {
        setItems((prev) => prev.filter((_, index) => index !== itemIndex));
        setActiveItemIndex(0);
      },
    });
  };

  const confirm = () => {
    if (firstIncompleteItem !== -1) return;
    if (requireConsent && !consentChecked) return;
    if (requireConsent) onConsentAccepted?.();
    onSubmit({ items, wasteRemoval });
  };

  const switchToPhotos =
    showSwitchToPhotos && onSwitchToPhotos ? (
      <button
        type="button"
        onClick={onSwitchToPhotos}
        className="-mr-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      >
        <Camera className="h-4 w-4" aria-hidden />
        {W.switchToPhotos}
      </button>
    ) : null;

  const footer = (() => {
    if (phase === 'item') {
      return (
        <WizardFooter
          sticky={stickyFooter}
          back={showBackInItem ? { label: W.back, onClick: goBack } : null}
          primary={{
            label: returnToReview && activeItemComplete ? W.backToReview : W.next,
            onClick: goNextFromItem,
            forward: true,
          }}
        />
      );
    }
    if (phase === 'interstitial') {
      return (
        <WizardFooter
          sticky={stickyFooter}
          back={{ label: W.back, onClick: goBack }}
          primary={{ label: W.finishItems, onClick: () => setPhase(asksWaste ? 'waste' : 'summary'), forward: true }}
        />
      );
    }
    if (phase === 'waste') {
      return (
        <WizardFooter
          sticky={stickyFooter}
          back={{ label: W.back, onClick: goBack }}
          primary={{
            label: W.continueToSummary,
            onClick: () => {
              setReturnToReview(false);
              setPhase('summary');
            },
            forward: true,
          }}
        />
      );
    }
    // Un único botón final: el que antes llevaba a la pantalla de consentimiento y el que
    // enviaba desde allí eran el mismo gesto partido en dos. La casilla sigue siendo
    // obligatoria, solo que se marca sin cambiar de pantalla.
    const incompleteNote =
      firstIncompleteItem === -1
        ? null
        : survey.repeatable
          ? W.incompleteNote(manualItemTitle(survey, firstIncompleteItem))
          : W.incompleteSingleNote;
    return (
      <WizardFooter
        sticky={stickyFooter}
        back={{ label: W.back, onClick: goBack }}
        primary={{
          label: submitting ? 'Guardando…' : submitLabel || MANUAL_ENTRY_STRINGS.consent.confirmCta,
          onClick: confirm,
          disabled: firstIncompleteItem !== -1 || (requireConsent && !consentChecked) || submitting,
        }}
        // El aviso va junto al botón que explica, no debajo de «Atrás».
        note={incompleteNote ?? (requireConsent && !consentChecked ? MANUAL_ENTRY_STRINGS.consent.mustAccept : null)}
      />
    );
  })();

  return (
    // Sin tarjeta envolvente: el asistente es la página. Con el pie fijo, el contenido deja
    // sitio abajo para que nada quede tapado por él.
    <div className={stickyFooter ? 'pb-10' : undefined}>
      {switchToPhotos ? <div className="-mt-2 mb-2 flex justify-end">{switchToPhotos}</div> : null}

      {/* Phase: item step */}
      {phase === 'item' && currentStep && (
        <div data-manual-screen={currentStep.id} data-manual-step-ids={currentStep.stepIds.join(' ')}>
          <ManualStepHeader
            eyebrow={eyebrow}
            title={currentStep.title}
            description={currentStep.description}
            headingRef={headingRef}
          />
          <div className="space-y-5">
            {currentStep.fields.map((field) => (
              <ManualFieldRenderer
                key={field.key}
                field={field}
                value={activeItem[field.key]}
                answers={activeItem}
                error={errorByField[field.key] ?? null}
                showError={showErrors || touched.has(field.key)}
                fieldPresentation={presentation.fields[field.key]}
                onChange={(value) => updateAnswer(field.key, value)}
                onBlur={() => markTouched(field.key)}
                // Intro en una pantalla de un solo campo = «Siguiente» (P-16).
                onEnter={currentStep.fields.length === 1 ? goNextFromItem : undefined}
              />
            ))}
          </div>
          {currentStep.measureHelp?.length ? (
            <HelpDisclosure>
              <ul className="space-y-1">
                {currentStep.measureHelp.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </HelpDisclosure>
          ) : null}
        </div>
      )}

      {/* Phase: interstitial (repeatable services) */}
      {phase === 'interstitial' && (
        <div data-manual-screen="interstitial">
          <ManualStepHeader
            eyebrow={eyebrow}
            title={W.addMoreTitle}
            description={W.addedCount(manualItemCount(survey, presentation, items.length))}
            headingRef={headingRef}
          />
          <ItemList
            items={items.map((item, index) => ({
              title: manualItemTitle(survey, index),
              summary: summarizeManualItem(survey, presentation, item),
              incomplete: firstIncompleteScreenIndex(survey, presentation, item) !== -1,
            }))}
            onEdit={editItemFromList}
            onRemove={removeItem}
          />
          <button
            type="button"
            onClick={addAnotherItem}
            className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-3 font-medium text-emerald-700 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {survey.addItemLabel || W.addItem}
          </button>
        </div>
      )}

      {/* Phase: global waste — elección explícita (D-09): mismo booleano, mismo valor por defecto. */}
      {phase === 'waste' && (
        <div data-manual-screen="waste">
          <ManualStepHeader
            eyebrow={eyebrow}
            title={MANUAL_GLOBAL_WASTE_STEP.title}
            description={MANUAL_GLOBAL_WASTE_STEP.description}
            headingRef={headingRef}
          />
          <OptionList
            id={manualFieldId(MANUAL_GLOBAL_WASTE_FIELD.key)}
            label={MANUAL_GLOBAL_WASTE_FIELD.label}
            options={[
              { value: 'true', label: WASTE.yes.label, help: WASTE.yes.help },
              { value: 'false', label: WASTE.no.label, help: WASTE.no.help },
            ]}
            selected={wasteRemoval ? 'true' : 'false'}
            onSelect={(value) => setWasteRemoval(value === 'true')}
          />
        </div>
      )}

      {/* Phase: summary */}
      {phase === 'summary' && (
        <div data-manual-screen="summary">
          <ManualStepHeader
            eyebrow={eyebrow}
            title={MANUAL_ENTRY_STRINGS.summary.title}
            description={MANUAL_ENTRY_STRINGS.summary.subtitle}
            headingRef={headingRef}
          />
          <ManualEntrySummary
            survey={survey}
            items={items}
            wasteRemoval={wasteRemoval}
            onChangeAnswer={changeAnswer}
            onChangeWaste={changeWaste}
            onRemoveItem={removeItem}
            requireConsent={requireConsent}
            consentChecked={consentChecked}
            onConsentChange={setConsentChecked}
            showHeading={false}
          />
          {/* El precio se ve en el paso siguiente: se dice una vez, aquí, y no en cada pregunta. */}
          {requireConsent ? <p className="mt-4 text-sm text-gray-600">{W.priceHint}</p> : null}
        </div>
      )}

      {footer}
      {confirmDialog}
    </div>
  );
};
