/**
 * Página del banco de pruebas: monta los componentes REALES de la entrada manual
 * (`ManualEntryChoice` y `ManualEntryWizard`) dentro del mismo marco que la página «Detalles»
 * y expone en `window.__qa` lo que el script de Playwright necesita para conducirla.
 *
 * El marco (cabecera, progreso de la reserva y contenedor) replica `DetailsPage.tsx` en el
 * modo manual. Si una fase cambia ese marco en `DetailsPage`, hay que cambiarlo aquí también
 * (o, mejor, extraerlo a un componente que usen los dos).
 *
 * Parámetros de la URL:
 *   ?s=<clave de servicio>   lawn | hedge | tree | palm | shrub | phytosanitary | weeding
 *   &gardener=1              modo corrección del jardinero (sin consentimiento, «Recalcular precio»)
 */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChevronLeft } from 'lucide-react';
import '../../../src/index.css';
import { ManualEntryChoice, type DataInputMode } from '../../../src/components/booking/manual/ManualEntryChoice';
import { ManualEntryWizard, type ManualWizardSubmitPayload } from '../../../src/components/booking/manual/ManualEntryWizard';
import {
  getFieldOptions,
  getVisibleFields,
  isManualOnlyService,
  MANUAL_ENTRY_SURVEYS,
  type ManualServiceKey,
} from '../../../src/shared/manualEntry/manualEntrySchema';
import { buildManualBookingPatch } from '../../../src/pages/reserva/manualEntryBuilders';
import { getManualPresentation, presentOption } from '../../../src/components/booking/manual/presentation/manualEntryPresentation';
import { MANUAL_PARITY_FIXTURES } from '../../../src/pages/reserva/manualEntryParityFixtures';

const params = new URLSearchParams(window.location.search);
const serviceKey = (params.get('s') || 'lawn') as ManualServiceKey;
const gardenerMode = params.get('gardener') === '1';
const survey = MANUAL_ENTRY_SURVEYS[serviceKey];

const qa = {
  serviceKey,
  gardenerMode,
  surveys: MANUAL_ENTRY_SURVEYS,
  getVisibleFields,
  getFieldOptions,
  // Etiqueta con la que se enseña cada opción (F6: «Muy grande (más de 9 m)»).
  shownOptionLabel: (key: ManualServiceKey, fieldKey: string, option: { value: string; label: string }) =>
    presentOption(option, getManualPresentation(key).fields[fieldKey]).label,
  buildManualBookingPatch,
  fixtures: MANUAL_PARITY_FIXTURES,
  submitted: null as ManualWizardSubmitPayload | null,
  drafts: 0,
  stepEvents: [] as string[],
  modeEvents: [] as string[],
  consentEvents: 0,
};
(window as unknown as { __qa: typeof qa }).__qa = qa;

function Page() {
  const [mode, setMode] = useState<DataInputMode>('manual');
  const manualOnly = isManualOnlyService(serviceKey);
  const selectMode = (next: DataInputMode) => {
    qa.modeEvents.push(next);
    setMode(next);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="mx-auto w-full px-4 py-4 sm:max-w-md flex items-center justify-between">
          <button
            type="button"
            aria-label="Volver al paso de servicios"
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            <ChevronLeft aria-hidden="true" className="w-5 h-5 text-gray-600" />
          </button>
          <h1 className="text-lg font-semibold text-gray-900">Detalles</h1>
          <div className="w-9" />
        </div>
      </div>
      <div className="bg-white">
        <div className="mx-auto w-full px-4 py-3 sm:max-w-md">
          <div className="flex items-center space-x-2 text-sm text-gray-600 mb-2">
            <span>Paso 3 de 5</span>
            <div className="flex-1 bg-gray-200 rounded-full h-1">
              <div className="bg-green-600 h-1 rounded-full" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      </div>
      <div data-qa-form className="mx-auto w-full px-4 py-6 pb-24 sm:max-w-md">
        {!gardenerMode && !manualOnly ? (
          <ManualEntryChoice mode={mode} onSelect={selectMode} compact={mode === 'manual'} />
        ) : null}
        {mode === 'manual' ? (
          <ManualEntryWizard
            survey={survey}
            requireConsent={!gardenerMode}
            // Igual que `DetailsPage` (F2): «Usar fotos» vive en el selector plegado y el pie va
            // fijo; en modo jardinero, como en el modal, el pie va en línea.
            showSwitchToPhotos={false}
            stickyFooter={!gardenerMode}
            submitLabel={gardenerMode ? 'Recalcular precio' : undefined}
            onDraftChange={() => {
              qa.drafts += 1;
            }}
            onStepComplete={(stepId) => qa.stepEvents.push(stepId)}
            onConsentAccepted={() => {
              qa.consentEvents += 1;
            }}
            onSubmit={(payload) => {
              qa.submitted = payload;
            }}
            onSwitchToPhotos={() => selectMode('photos')}
          />
        ) : (
          <p className="text-sm text-gray-600">Modo fotos (fuera del alcance del banco).</p>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Page />);
