import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useProviderMode } from '../../hooks/useProviderMode';
import { useProviderSetupStatus } from '../../hooks/useProviderSetupStatus';
import ActivationShell, { PRIMARY_BUTTON_CLASS } from '../../components/activation/ActivationShell';
import WelcomeStep from '../../components/activation/WelcomeStep';
import ZoneStep from '../../components/activation/ZoneStep';
import ServicesStep from '../../components/activation/ServicesStep';
import {
  blockNumber,
  estimatedMinutes,
  nextStep,
  pauseActivation,
  previousStep,
  progressPercent,
  readActivationProgress,
  resumeActivation,
  writeActivationProgress,
  type ActivationProgress,
  type ActivationStepId,
} from '../../activation/activationFlow';
import { ACTIVATION_SERVICES, sortActivationServices, type ActivationServiceName } from '../../activation/serviceCatalog';
import { loadActivationData, saveCoverage, type ActivationData } from '../../activation/activationData';

// Cuestionario «Activa tu cuenta» (2026-11-11). Lo abre el panel mientras al profesional le falte algo
// para recibir reservas. Cada paso guarda en las tablas de siempre al pulsar el botón principal; aquí solo
// se lleva el paso en el que va. Diseño: docs/activacion-profesional/01-diseno-cuestionarios.md.

const isKnownService = (name: string): name is ActivationServiceName => ACTIVATION_SERVICES.some((s) => s.name === name);

const ActivationWizardPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { isTeam } = useProviderMode();
  const setup = useProviderSetupStatus();
  const home = isTeam ? '/empresa' : '/dashboard';

  const [data, setData] = useState<ActivationData | null>(null);
  const [loadError, setLoadError] = useState<'not_a_provider' | 'failed' | null>(null);
  const [progress, setProgress] = useState<ActivationProgress | null>(null);

  // Paso 1 (zona)
  const [address, setAddress] = useState('');
  const [maxDistance, setMaxDistance] = useState(25);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    loadActivationData(user.id)
      .then((loaded) => {
        if (cancelled) return;
        setData(loaded);
        setAddress(loaded.address);
        setMaxDistance(loaded.maxDistance);
        const saved = readActivationProgress(user.id, isKnownService);
        setProgress(saved ?? { step: 'welcome', selectedServices: loaded.preselectedServices });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(error instanceof Error && error.message === 'not_a_provider' ? 'not_a_provider' : 'failed');
      });
    // Entrar aquí (a mano o desde el panel) es retomar: deja de estar pausado en esta sesión.
    resumeActivation();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const go = useCallback(
    (next: ActivationProgress) => {
      setProgress(next);
      if (user?.id) writeActivationProgress(user.id, next);
      window.scrollTo({ top: 0 });
    },
    [user?.id],
  );

  const pause = useCallback(() => {
    pauseActivation();
    navigate(home);
  }, [home, navigate]);

  const isCompany = setup.status?.provider_kind === 'company' || isTeam;
  const selected = progress?.selectedServices ?? [];
  const step: ActivationStepId = progress?.step ?? 'welcome';
  const block = blockNumber(step);
  const stepLabel = block ? `Paso ${block} de 4` : step === 'welcome' ? 'Bienvenida' : 'Último paso';
  const percent = progressPercent(step, selected);
  const minutes = useMemo(() => estimatedMinutes(data?.preselectedServices.length ?? 0), [data?.preselectedServices.length]);

  if (loadError === 'not_a_provider') return <Navigate to="/dashboard" replace />;
  if (loadError === 'failed') {
    return (
      <div className="mx-auto max-w-xl p-6 text-center">
        <p className="font-semibold text-gray-900">No hemos podido cargar tu cuenta.</p>
        <button type="button" onClick={() => window.location.reload()} className={`${PRIMARY_BUTTON_CLASS} mt-4`}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!data || !progress || !user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center" role="status">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-hidden="true" />
        <span className="sr-only">Cargando</span>
      </div>
    );
  }

  const advance = (patch: Partial<ActivationProgress> = {}) => {
    const nextSelected = patch.selectedServices ?? progress.selectedServices;
    go({ ...progress, ...patch, step: nextStep(progress.step, nextSelected), selectedServices: nextSelected });
  };
  const back = step === 'welcome' ? undefined : () => go({ ...progress, step: previousStep(progress.step, selected) });

  const confirmZone = async () => {
    if (busy) return;
    setZoneError(null);
    if (!address.trim()) {
      setZoneError('Escribe la dirección desde la que trabajas y elige una de las sugerencias.');
      return;
    }
    setBusy(true);
    try {
      const result = await saveCoverage(user.id, { address: data.address, hasCoordinates: data.hasCoordinates }, { address, maxDistance });
      if (!result.ok) {
        setZoneError(
          result.reason === 'address_not_found'
            ? 'No encontramos esa dirección en el mapa. Bórrala y escríbela de nuevo eligiendo una de las sugerencias.'
            : 'No se ha podido guardar. Inténtalo de nuevo.',
        );
        return;
      }
      setData({ ...data, address: address.trim(), maxDistance, hasCoordinates: true });
      advance();
    } finally {
      setBusy(false);
    }
  };

  const toggleService = (name: ActivationServiceName) => {
    const set = new Set(progress.selectedServices);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    go({ ...progress, selectedServices: sortActivationServices(set) });
  };

  let body: React.ReactNode;
  let footer: React.ReactNode;
  if (step === 'welcome') {
    body = <WelcomeStep firstName={data.firstName} isCompany={isCompany} minutes={minutes} />;
    footer = (
      <button type="button" onClick={() => advance()} className={PRIMARY_BUTTON_CLASS}>
        Empezar
      </button>
    );
  } else if (step === 'zone') {
    body = (
      <ZoneStep
        address={address}
        maxDistance={maxDistance}
        onAddressChange={(value) => {
          setAddress(value);
          setZoneError(null);
        }}
        onDistanceChange={setMaxDistance}
        error={zoneError}
      />
    );
    footer = (
      <button type="button" onClick={() => void confirmZone()} disabled={busy} className={PRIMARY_BUTTON_CLASS}>
        {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
        {busy ? 'Comprobando la dirección…' : 'Confirmar zona y seguir'}
      </button>
    );
  } else if (step === 'services') {
    body = <ServicesStep isCompany={isCompany} selected={selected} onToggle={toggleService} />;
    footer = (
      <button type="button" onClick={() => advance()} disabled={selected.length === 0} className={PRIMARY_BUTTON_CLASS}>
        {selected.length === 0 ? 'Marca al menos un servicio' : `Seguir con ${selected.length === 1 ? '1 servicio' : `${selected.length} servicios`}`}
      </button>
    );
  } else {
    // F2-F6: tarifas por servicio, horario, equipo y final.
    body = (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{step.startsWith('service:') ? step.slice('service:'.length) : step}</h1>
        <p className="mt-2 text-gray-600">Este paso se está construyendo.</p>
      </div>
    );
    footer = (
      <button type="button" onClick={() => (step === 'finish' ? navigate(home) : advance())} className={PRIMARY_BUTTON_CLASS}>
        Seguir
      </button>
    );
  }

  return (
    <ActivationShell stepLabel={stepLabel} percent={percent} onBack={back} onPause={pause} footer={footer}>
      {body}
    </ActivationShell>
  );
};

export default ActivationWizardPage;
