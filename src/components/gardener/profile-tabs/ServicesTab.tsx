import React, { useEffect, useState } from 'react';
import { Briefcase, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import ServiceItem from '../ServiceItem';
import SlideOver from '../../common/SlideOver';
import PalmPricingConfigurator, { PalmPricingConfig } from '../PalmPricingConfigurator';
import LawnPricingConfigurator, { LawnPricingConfig } from '../LawnPricingConfigurator';
import HedgePricingConfigurator, { HedgePricingConfig } from '../HedgePricingConfigurator';
import TreePruningConfigurator from '../TreePruningConfigurator';
import { TreePruningServiceConfig } from '../../../types/treePruning';
import ShrubPricingConfigurator, { ShrubPricingConfig } from '../ShrubPricingConfigurator';
import PhytosanitaryPricingConfigurator, { PhytosanitaryPricingConfig } from '../PhytosanitaryPricingConfigurator';
import WeedingPricingConfigurator, { WeedingPricingConfig } from '../WeedingPricingConfigurator';
import { useConfirmDialog } from '../../common/ConfirmDialog';
import ResetOptionsModal from '../../common/ResetOptionsModal';
import { ensurePhytosanitaryPersistedConfig } from '../../../utils/phytosanitaryConfig';
import type { ManualSaveResult } from '../../../hooks/useManualSave';

interface ServicesTabProps {
  sortedServices: any[];
  watchedServices: string[];
  expandedServiceId: string | null;
  handleToggleService: (id: string) => void;
  handleExpand: (id: string) => void;
  handleWrapperSave: (name: string, config: any) => Promise<boolean>;
  configs: {
    palmConfig: any;
    lawnConfig: any;
    hedgeConfig: any;
    treePruningConfig: any;
    shrubConfig: any;
    phytosanitaryConfig: any;
    weedingConfig: any;
  };
  setConfigs: {
    setPalmConfig: any;
    setLawnConfig: any;
    setHedgeConfig: any;
    setTreePruningConfig: any;
    setShrubConfig: any;
    setPhytosanitaryConfig: any;
    setWeedingConfig: any;
  };
  savedConfigs: any;
  licenseStatus: 'pending' | 'approved' | 'rejected' | 'expired' | null;
  /** D3: lleva al jardinero a la pestaña donde sube/renueva su carnet, cerrando este panel. */
  onGoToLicense: () => void;
}

/**
 * Cómo "Restablecer" (fallo 9) devuelve cada servicio a un estado concreto: se usa tanto
 * para "cambios no guardados" (pasando `savedConfigs[nombre]`) como para "restablecer
 * completamente" (pasando `undefined`, que cada configurador ya sabe convertir en su
 * propio estado vacío — es el mismo camino que sigue un servicio nunca configurado).
 * Vive aquí — no en ProfileSettings — porque este es el único sitio que abre un configurador
 * concreto; fitosanitarios necesita el mismo envoltorio de normalización que ya usaba
 * `handleModalDiscard` para no dejar el estado en una forma distinta a la que carga al inicio.
 */
const SERVICE_RESET: Record<string, (setConfigs: ServicesTabProps['setConfigs'], saved: any) => void> = {
  'Poda de palmeras': (s, saved) => s.setPalmConfig(saved),
  'Corte de césped': (s, saved) => s.setLawnConfig(saved),
  'Poda de setos': (s, saved) => s.setHedgeConfig(saved),
  'Poda de árboles': (s, saved) => s.setTreePruningConfig(saved),
  'Poda de plantas y arbustos': (s, saved) => s.setShrubConfig(saved),
  'Servicios fitosanitarios': (s, saved) => s.setPhytosanitaryConfig(ensurePhytosanitaryPersistedConfig(saved)),
  'Desbroce de malas hierbas': (s, saved) => s.setWeedingConfig(saved),
};

const ServicesTab: React.FC<ServicesTabProps> = ({
  sortedServices,
  watchedServices,
  handleToggleService,
  handleExpand,
  handleWrapperSave,
  configs,
  setConfigs,
  savedConfigs,
  licenseStatus,
  onGoToLicense
}) => {
  const [slideOverService, setSlideOverService] = useState<any>(null);
  // Guardado manual (fallo 10): cada configurador registra aquí su propia función de
  // guardado (con la transformación que le corresponda) y su estado "hay cambios sin
  // guardar" — igual que el patrón ya usado en Gestión de Disponibilidad.
  const [registeredSave, setRegisteredSave] = useState<(() => Promise<ManualSaveResult>) | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showResetOptions, setShowResetOptions] = useState(false);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  // Al abrir un servicio distinto (o cerrar), se descarta el registro del anterior — evita
  // guardar o comprobar cambios de un configurador que ya no está montado.
  useEffect(() => {
    setRegisteredSave(null);
    setIsDirty(false);
    setShowResetOptions(false);
  }, [slideOverService?.id]);

  const closeSlideOver = () => setSlideOverService(null);

  const requestCloseSlideOver = () => {
    if (!isDirty) {
      closeSlideOver();
      return;
    }
    openConfirm({
      title: '¿Deseas guardar los cambios?',
      message: `Tienes cambios sin guardar en la configuración de ${slideOverService?.name}. Si sales sin guardar, se perderán.`,
      confirmLabel: 'Guardar cambios',
      cancelLabel: 'No guardar',
      tone: 'warning',
      onConfirm: async () => {
        setSaving(true);
        const result = await registeredSave?.();
        setSaving(false);
        if (result === 'success') {
          closeSlideOver();
        } else if (result === 'invalid') {
          toast.error('Revisa los campos marcados en rojo antes de guardar.');
        }
        // 'error': handleWrapperSave ya mostró su propio aviso; el panel se queda abierto
        // para que el jardinero pueda reintentar sin perder lo escrito.
      },
      onCancel: () => {
        if (slideOverService && SERVICE_RESET[slideOverService.name]) {
          SERVICE_RESET[slideOverService.name](setConfigs, savedConfigs[slideOverService.name]);
        }
        closeSlideOver();
      },
    });
  };

  const handleSaveClick = async () => {
    if (!registeredSave) return;
    setSaving(true);
    const result = await registeredSave();
    setSaving(false);
    if (result === 'invalid') {
      toast.error('Revisa los campos marcados en rojo antes de guardar.');
    }
  };

  const handleResetToSaved = () => {
    if (slideOverService && SERVICE_RESET[slideOverService.name]) {
      SERVICE_RESET[slideOverService.name](setConfigs, savedConfigs[slideOverService.name]);
    }
    setShowResetOptions(false);
  };

  const handleResetToBlank = () => {
    if (slideOverService && SERVICE_RESET[slideOverService.name]) {
      SERVICE_RESET[slideOverService.name](setConfigs, undefined);
    }
    setShowResetOptions(false);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 flex items-center">
        <Briefcase className="w-5 h-5 mr-2 text-green-600" />
        Servicios que ofreces
      </h3>

      <div className="grid grid-cols-1 gap-4">
        {sortedServices.map(service => {
          const isSelected = watchedServices.includes(service.id);

          return (
            <ServiceItem
              key={service.id}
              service={service}
              isActive={isSelected}
              hasError={false}
              onToggle={() => handleToggleService(service.id)}
              onConfigClick={() => {
                setSlideOverService(service);
                handleExpand(service.id);
              }}
            />
          );
        })}
      </div>

      <SlideOver
        isOpen={!!slideOverService}
        onClose={requestCloseSlideOver}
        title={`Configurar ${slideOverService?.name || ''}`}
        headerActions={
          <>
            <button
              type="button"
              onClick={() => setShowResetOptions(true)}
              disabled={!isDirty || saving}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Restablecer
            </button>
            <button
              type="button"
              onClick={() => void handleSaveClick()}
              disabled={!isDirty || saving}
              className={`flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold transition-all ${
                isDirty
                  ? 'bg-gradient-to-r from-green-600 to-emerald-600 text-white shadow-sm hover:from-green-700 hover:to-emerald-700 active:scale-[0.98]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Save className="w-4 h-4" />
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
          </>
        }
      >
        {slideOverService && (
          <div className="pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-12">
            {slideOverService.name === 'Poda de palmeras' && (
              <PalmPricingConfigurator
                value={configs.palmConfig}
                initialConfig={savedConfigs['Poda de palmeras']}
                onChange={setConfigs.setPalmConfig}
                onSave={(c) => handleWrapperSave('Poda de palmeras', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
              />
            )}
            {slideOverService.name === 'Corte de césped' && (
              <LawnPricingConfigurator
                value={configs.lawnConfig}
                initialConfig={savedConfigs['Corte de césped']}
                onChange={setConfigs.setLawnConfig}
                onSave={(c) => handleWrapperSave('Corte de césped', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
              />
            )}
            {slideOverService.name === 'Poda de setos' && (
              <HedgePricingConfigurator
                value={configs.hedgeConfig}
                initialConfig={savedConfigs['Poda de setos']}
                onChange={setConfigs.setHedgeConfig}
                onSave={(c) => handleWrapperSave('Poda de setos', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
              />
            )}
            {slideOverService.name === 'Poda de árboles' && (
              <TreePruningConfigurator
                value={configs.treePruningConfig}
                initialConfig={savedConfigs['Poda de árboles']}
                onChange={setConfigs.setTreePruningConfig}
                onSave={(c) => handleWrapperSave('Poda de árboles', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
              />
            )}
            {slideOverService.name === 'Poda de plantas y arbustos' && (
              <ShrubPricingConfigurator
                value={configs.shrubConfig}
                initialConfig={savedConfigs['Poda de plantas y arbustos']}
                onChange={setConfigs.setShrubConfig}
                onSave={(c) => handleWrapperSave('Poda de plantas y arbustos', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
              />
            )}
            {slideOverService.name === 'Servicios fitosanitarios' && (
              <PhytosanitaryPricingConfigurator
                value={configs.phytosanitaryConfig}
                initialConfig={savedConfigs['Servicios fitosanitarios']}
                onChange={setConfigs.setPhytosanitaryConfig}
                onSave={(c) => handleWrapperSave('Servicios fitosanitarios', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
                licenseStatus={licenseStatus}
                onGoToLicense={() => { setSlideOverService(null); onGoToLicense(); }}
              />
            )}
            {slideOverService.name === 'Desbroce de malas hierbas' && (
              <WeedingPricingConfigurator
                value={configs.weedingConfig}
                initialConfig={savedConfigs['Desbroce de malas hierbas']}
                onChange={setConfigs.setWeedingConfig}
                onSave={(c) => handleWrapperSave('Desbroce de malas hierbas', c)}
                registerSave={(fn) => setRegisteredSave(() => fn)}
                onDirtyChange={setIsDirty}
                licenseStatus={licenseStatus}
                onGoToLicense={() => { setSlideOverService(null); onGoToLicense(); }}
              />
            )}
          </div>
        )}
      </SlideOver>

      <ResetOptionsModal
        isOpen={showResetOptions}
        serviceName={slideOverService?.name || ''}
        onResetToSaved={handleResetToSaved}
        onResetToBlank={handleResetToBlank}
        onClose={() => setShowResetOptions(false)}
      />

      {confirmDialog}
    </div>
  );
};

export default ServicesTab;
