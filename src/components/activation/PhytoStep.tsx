import React, { useState } from 'react';
import PhytosanitaryLicenseUpload from '../gardener/PhytosanitaryLicenseUpload';
import PhytosanitaryPricingConfigurator from '../gardener/PhytosanitaryPricingConfigurator';
import type { PhytosanitaryPricingConfig } from '../../types';
import type { ManualSaveResult } from '../../hooks/useManualSave';
import { ensurePhytosanitaryPersistedConfig, normalizePhytosanitaryPricingConfig } from '../../utils/phytosanitaryConfig';

// Fitosanitarios dentro del cuestionario «Activa tu cuenta» (2026-11-11). Es el servicio más técnico: usa
// a la vez matrices por tratamiento y precios detallados, con conversiones propias al guardar. Para no tener
// una segunda lógica de precios que pudiera cobrar distinto, aquí va EL MISMO configurador de «Mi perfil →
// Servicios» (mismo guardado y misma validación), con el carnet de aplicador encima: sin carnet aprobado no
// se ofrecen los tratamientos químicos.

type LicenseStatus = 'pending' | 'approved' | 'rejected' | 'expired' | null;

interface Props {
  savedConfig: unknown;
  licenseStatus: LicenseStatus;
  onSave: (config: PhytosanitaryPricingConfig) => Promise<boolean>;
  /** Recibe la función que guarda (la llama el botón «Guardar y seguir»). */
  registerSave: (save: () => Promise<ManualSaveResult>) => void;
}

export const initialPhytoConfig = (saved: unknown): PhytosanitaryPricingConfig =>
  ensurePhytosanitaryPersistedConfig(normalizePhytosanitaryPricingConfig(saved as PhytosanitaryPricingConfig | undefined));

const PhytoStep: React.FC<Props> = ({ savedConfig, licenseStatus, onSave, registerSave }) => {
  const [initial] = useState(() => initialPhytoConfig(savedConfig));
  const [value, setValue] = useState<PhytosanitaryPricingConfig>(initial);

  return (
    <div>
      <p className="text-sm font-semibold text-emerald-800">Fitosanitarios</p>
      <h1 className="mt-1 text-2xl font-bold leading-tight text-gray-900">Tratamientos fitosanitarios</h1>
      <p className="mt-2 text-gray-700">
        Primero, tu carnet de aplicador. Después, tus tarifas: es el mismo configurador que tendrás en «Mi perfil → Servicios».
      </p>

      <div className="mt-5" id="activation-license">
        <PhytosanitaryLicenseUpload intro="Sin el carnet aprobado puedes guardar tus tarifas, pero solo te llegarán los tratamientos ecológicos. GarSer lo revisa y te avisa." />
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-3 sm:p-4">
        <PhytosanitaryPricingConfigurator
          value={value}
          initialConfig={initial}
          onChange={setValue}
          onSave={onSave}
          registerSave={registerSave}
          licenseStatus={licenseStatus}
          onGoToLicense={() => document.getElementById('activation-license')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      </div>
    </div>
  );
};

export default PhytoStep;
