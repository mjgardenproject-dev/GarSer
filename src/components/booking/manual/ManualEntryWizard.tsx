import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Plus } from 'lucide-react';
import {
  getVisibleFields,
  MANUAL_GLOBAL_WASTE_FIELD,
  type ManualAnswers,
  type ManualServiceSurvey,
} from '../../../shared/manualEntry/manualEntrySchema';
import { validateManualField } from '../../../shared/manualEntry/manualEntryValidation';
import { MANUAL_ENTRY_STRINGS } from '../../../shared/manualEntry/strings';
import { ManualFieldRenderer } from './fields/ManualFieldRenderer';
import { ManualEntrySummary } from './ManualEntrySummary';
import { ManualEntryConsent } from './ManualEntryConsent';

type WizardPhase = 'item' | 'interstitial' | 'waste' | 'summary' | 'consent';

export interface ManualWizardSubmitPayload {
  items: ManualAnswers[];
  wasteRemoval: boolean;
}

interface Props {
  survey: ManualServiceSurvey;
  submitting?: boolean;
  initialItems?: ManualAnswers[];
  initialWasteRemoval?: boolean;
  /** When false, the legal-consent step is skipped (e.g. gardener on-site correction). */
  requireConsent?: boolean;
  /** Final action label when consent is not required. */
  submitLabel?: string;
  /** When false, the "switch to photos" affordance is hidden. */
  showSwitchToPhotos?: boolean;
  onDraftChange?: (payload: ManualWizardSubmitPayload) => void;
  onStepComplete?: (stepId: string) => void;
  onConsentAccepted?: () => void;
  onSubmit: (payload: ManualWizardSubmitPayload) => void;
  onSwitchToPhotos?: () => void;
}

const W = MANUAL_ENTRY_STRINGS.wizard;

function makeEmptyItem(survey: ManualServiceSurvey): ManualAnswers {
  const item: ManualAnswers = {};
  survey.steps.forEach((step) =>
    step.fields.forEach((field) => {
      if (field.defaultValue !== undefined) item[field.key] = field.defaultValue;
    }),
  );
  return item;
}

export const ManualEntryWizard: React.FC<Props> = ({
  survey,
  submitting = false,
  initialItems,
  initialWasteRemoval,
  requireConsent = true,
  submitLabel,
  showSwitchToPhotos = true,
  onDraftChange,
  onStepComplete,
  onConsentAccepted,
  onSubmit,
  onSwitchToPhotos,
}) => {
  const [items, setItems] = useState<ManualAnswers[]>(
    initialItems && initialItems.length > 0 ? initialItems : [makeEmptyItem(survey)],
  );
  const [wasteRemoval, setWasteRemoval] = useState<boolean>(
    initialWasteRemoval ?? (MANUAL_GLOBAL_WASTE_FIELD.defaultValue === true),
  );
  const [activeItemIndex, setActiveItemIndex] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [phase, setPhase] = useState<WizardPhase>('item');
  const [consentChecked, setConsentChecked] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const activeItem = items[activeItemIndex] || {};
  const visibleSteps = useMemo(
    () => survey.steps.filter((step) => getVisibleFields(step, activeItem).length > 0),
    [survey, activeItem],
  );
  const currentStep = visibleSteps[activeStepIndex];

  useEffect(() => {
    onDraftChange?.({ items, wasteRemoval });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, wasteRemoval]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [phase, activeStepIndex, activeItemIndex]);

  const updateAnswer = (key: string, value: ManualAnswers[string]) => {
    setItems((prev) => {
      const next = [...prev];
      next[activeItemIndex] = { ...next[activeItemIndex], [key]: value };
      return next;
    });
  };

  const currentStepErrors = useMemo(() => {
    if (phase !== 'item' || !currentStep) return [] as Array<{ field: string; message: string }>;
    return getVisibleFields(currentStep, activeItem)
      .map((field) => validateManualField(field, activeItem[field.key], activeItem))
      .filter((error): error is NonNullable<typeof error> => Boolean(error))
      .map((error) => ({ field: error.field, message: error.message }));
  }, [phase, currentStep, activeItem]);

  const errorByField = useMemo(() => {
    const map: Record<string, string> = {};
    currentStepErrors.forEach((error) => {
      map[error.field] = error.message;
    });
    return map;
  }, [currentStepErrors]);

  const progressPct = useMemo(() => {
    if (phase === 'item') return Math.round(((activeStepIndex + 1) / (visibleSteps.length + 3)) * 100);
    if (phase === 'interstitial') return Math.round(((visibleSteps.length + 0.5) / (visibleSteps.length + 3)) * 100);
    if (phase === 'waste') return Math.round(((visibleSteps.length + 1) / (visibleSteps.length + 3)) * 100);
    if (phase === 'summary') return Math.round(((visibleSteps.length + 2) / (visibleSteps.length + 3)) * 100);
    return 100;
  }, [phase, activeStepIndex, visibleSteps.length]);

  const goNextFromItem = () => {
    if (currentStepErrors.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (currentStep) onStepComplete?.(currentStep.id);

    if (activeStepIndex < visibleSteps.length - 1) {
      setActiveStepIndex((index) => index + 1);
      return;
    }
    // Finished the active item.
    setPhase(survey.repeatable ? 'interstitial' : 'waste');
  };

  const goBack = () => {
    setShowErrors(false);
    if (phase === 'consent') return setPhase('summary');
    if (phase === 'summary') return setPhase('waste');
    if (phase === 'waste') {
      if (survey.repeatable) return setPhase('interstitial');
      setActiveItemIndex(items.length - 1);
      setActiveStepIndex(Math.max(0, visibleSteps.length - 1));
      return setPhase('item');
    }
    if (phase === 'interstitial') {
      setActiveStepIndex(Math.max(0, visibleSteps.length - 1));
      return setPhase('item');
    }
    // phase === 'item'
    if (activeStepIndex > 0) {
      setActiveStepIndex((index) => index - 1);
      return;
    }
    if (activeItemIndex > 0) {
      setActiveItemIndex((index) => index - 1);
      setActiveStepIndex(0);
      return;
    }
    // First screen: nothing to go back to within the wizard.
  };

  const addAnotherItem = () => {
    setItems((prev) => [...prev, makeEmptyItem(survey)]);
    setActiveItemIndex(items.length);
    setActiveStepIndex(0);
    setPhase('item');
  };

  const editItem = (itemIndex: number) => {
    setActiveItemIndex(itemIndex);
    setActiveStepIndex(0);
    setShowErrors(false);
    setPhase('item');
  };

  const confirm = () => {
    if (requireConsent && !consentChecked) return;
    if (requireConsent) onConsentAccepted?.();
    onSubmit({ items, wasteRemoval });
  };

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 sm:p-6">
      {/* Progress */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-500">
            {phase === 'item' ? W.stepProgress(activeStepIndex + 1, visibleSteps.length) : survey.serviceLabel}
          </span>
          {showSwitchToPhotos && onSwitchToPhotos && (
            <button
              type="button"
              onClick={onSwitchToPhotos}
              className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded px-2 py-1"
            >
              <Camera className="w-3.5 h-3.5" aria-hidden />
              {W.switchToPhotos}
            </button>
          )}
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-green-600 transition-all duration-300" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      {/* Phase: item step */}
      {phase === 'item' && currentStep && (
        <div>
          <h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-gray-900 outline-none">
            {currentStep.title}
          </h3>
          {currentStep.description && <p className="text-sm text-gray-500 mt-1 mb-4 leading-relaxed">{currentStep.description}</p>}
          {!currentStep.description && <div className="mb-4" />}
          <div className="space-y-5">
            {getVisibleFields(currentStep, activeItem).map((field) => (
              <ManualFieldRenderer
                key={field.key}
                field={field}
                value={activeItem[field.key]}
                answers={activeItem}
                error={showErrors ? errorByField[field.key] : null}
                onChange={(value) => updateAnswer(field.key, value)}
              />
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-5">{W.priceHint}</p>
        </div>
      )}

      {/* Phase: interstitial (repeatable services) */}
      {phase === 'interstitial' && (
        <div className="text-center py-4">
          <h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-gray-900 outline-none">
            ¿Quieres añadir más?
          </h3>
          <p className="text-sm text-gray-500 mt-1 mb-5">
            Has añadido {items.length} {items.length === 1 ? survey.itemNoun : `${survey.itemNoun}s`}.
          </p>
          <div className="flex flex-col gap-3 max-w-xs mx-auto">
            <button
              type="button"
              onClick={addAnotherItem}
              className="inline-flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-green-200 text-green-700 font-medium hover:bg-green-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              <Plus className="w-4 h-4" aria-hidden />
              {survey.addItemLabel || W.addItem}
            </button>
            <button
              type="button"
              onClick={() => setPhase('waste')}
              className="py-3 px-4 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            >
              {W.finishItems}
            </button>
          </div>
        </div>
      )}

      {/* Phase: global waste */}
      {phase === 'waste' && (
        <div>
          <h3 ref={headingRef} tabIndex={-1} className="text-lg font-bold text-gray-900 outline-none mb-4">
            {MANUAL_GLOBAL_WASTE_FIELD.label}
          </h3>
          <ManualFieldRenderer
            field={MANUAL_GLOBAL_WASTE_FIELD}
            value={wasteRemoval}
            answers={{}}
            onChange={(value) => setWasteRemoval(value === true)}
          />
        </div>
      )}

      {/* Phase: summary */}
      {phase === 'summary' && (
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          <ManualEntrySummary survey={survey} items={items} wasteRemoval={wasteRemoval} onEditItem={editItem} />
        </div>
      )}

      {/* Phase: consent */}
      {phase === 'consent' && (
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          <ManualEntryConsent checked={consentChecked} onChange={setConsentChecked} />
        </div>
      )}

      {/* Footer navigation */}
      <div className="mt-6 flex items-center gap-3">
        {phase !== 'interstitial' && (
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-1 py-3 px-4 rounded-xl border border-gray-200 text-gray-600 font-medium hover:bg-gray-50 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            {W.back}
          </button>
        )}
        <div className="flex-1" />
        {phase === 'item' && (
          <button
            type="button"
            onClick={goNextFromItem}
            disabled={showErrors && currentStepErrors.length > 0}
            className="inline-flex items-center gap-1 py-3 px-6 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {W.next}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
        )}
        {phase === 'waste' && (
          <button
            type="button"
            onClick={() => setPhase('summary')}
            className="inline-flex items-center gap-1 py-3 px-6 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {W.continueToSummary}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
        )}
        {phase === 'summary' && requireConsent && (
          <button
            type="button"
            onClick={() => setPhase('consent')}
            className="inline-flex items-center gap-1 py-3 px-6 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {W.next}
            <ArrowRight className="w-4 h-4" aria-hidden />
          </button>
        )}
        {phase === 'summary' && !requireConsent && (
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="inline-flex items-center gap-1 py-3 px-6 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {submitting ? 'Guardando…' : (submitLabel || MANUAL_ENTRY_STRINGS.consent.confirmCta)}
          </button>
        )}
        {phase === 'consent' && (
          <button
            type="button"
            onClick={confirm}
            disabled={!consentChecked || submitting}
            className="inline-flex items-center gap-1 py-3 px-6 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
          >
            {submitting ? 'Guardando…' : MANUAL_ENTRY_STRINGS.consent.confirmCta}
          </button>
        )}
      </div>

      {phase === 'consent' && !consentChecked && (
        <p className="text-xs text-gray-400 mt-2 text-right">{MANUAL_ENTRY_STRINGS.consent.mustAccept}</p>
      )}
    </div>
  );
};
