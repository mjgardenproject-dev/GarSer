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
import QuestionScreen from '../../components/activation/QuestionScreen';
import ServiceReview from '../../components/activation/ServiceReview';
import PhytoStep from '../../components/activation/PhytoStep';
import ScheduleStep from '../../components/activation/ScheduleStep';
import TeamStep, { type TeamAnswer } from '../../components/activation/TeamStep';
import FinishStep from '../../components/activation/FinishStep';
import { placeLabel } from '../../components/activation/ZoneStep';
import { createTeamInvitation, looksLikeEmail, presetProblem, setInvitationPreset, type TeamInvitationResult } from '../../utils/teamInvitations';
import { isSavedServiceConfigValid, setServiceActive } from '../../utils/serviceActivation';
import { buildProviderSetupSteps } from '../../shared/providerSetup';
import { emptyWeek, rulesToRanges, scheduleProblem, rangesToMatrix, weeklyHours, type WeekRanges } from '../../activation/scheduleModel';
import { saveOwnRecurringSchedule } from '../../utils/recurringSchedulePersistence';
import { notifySetupChanged } from '../../utils/setupEvents';
import type { ManualSaveResult } from '../../hooks/useManualSave';
import { SERVICE_QUESTIONNAIRES } from '../../activation/questionnaires';
import {
  isQuestionAnswered,
  previewQuotes,
  questionCountUpperBound,
  visibleQuestions,
  type Answers,
} from '../../activation/pricingQuestions';
import {
  blockNumber,
  clearActivationProgress,
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
import { ACTIVATION_SERVICES, serviceInfo, sortActivationServices, type ActivationServiceName } from '../../activation/serviceCatalog';
import { loadActivationData, saveCoverage, saveServiceConfig, type ActivationData } from '../../activation/activationData';

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
  const [serviceError, setServiceError] = useState<string | null>(null);
  // Paso 3 (horario)
  const [week, setWeek] = useState<WeekRanges>(emptyWeek);
  const [notice, setNotice] = useState<number | null>(null);
  const [weeksAhead, setWeeksAhead] = useState<number | null>(null);
  const [scheduleTouched, setScheduleTouched] = useState(false);
  // Paso 4 (equipo) y final
  const [team, setTeam] = useState<TeamAnswer>({ answer: null, emails: [], presets: [], declared: false });
  const [sentInvites, setSentInvites] = useState<TeamInvitationResult[]>([]);
  const [emailErrors, setEmailErrors] = useState<Record<number, string>>({});
  const [finishPhase, setFinishPhase] = useState<'review' | 'done'>('review');
  // Fitosanitarios: el configurador de siempre registra aquí su «guardar».
  const [phytoSave, setPhytoSave] = useState<(() => Promise<ManualSaveResult>) | null>(null);
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
        setWeek(loaded.schedule.rules.length > 0 ? rulesToRanges(loaded.schedule.rules) : emptyWeek());
        setNotice(loaded.schedule.minNoticeHours);
        setWeeksAhead(loaded.schedule.weeksToMaintain);
        // Si en el alta dijo «somos 4», al elegir «Sí» salen 3 huecos para sus correos.
        const slots = Math.max(1, (loaded.estimatedTeamSize ?? 2) - 1);
        const n = Math.min(slots, 10);
        setTeam({ answer: null, emails: Array.from({ length: n }, () => ''), presets: Array.from({ length: n }, () => null), declared: false });
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
    (next: ActivationProgress, options: { scroll?: boolean } = {}) => {
      setProgress(next);
      if (user?.id) writeActivationProgress(user.id, next);
      if (options.scroll !== false) window.scrollTo({ top: 0 });
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

  // Un servicio que ya tiene sus tarifas bien guardadas empieza en su resumen: no se le hace contestar todo otra vez.
  const firstIndexFor = (next: ActivationStepId): number => {
    if (!next.startsWith('service:')) return 0;
    const name = next.slice('service:'.length) as ActivationServiceName;
    const q = SERVICE_QUESTIONNAIRES[name];
    const saved = data.savedServices[name]?.config;
    if (!q || !saved || progress.serviceAnswers?.[name]) return 0;
    try {
      return q.isValid(q.toConfig(q.fromConfig(saved), saved)) ? Number.MAX_SAFE_INTEGER : 0;
    } catch {
      return 0;
    }
  };
  const advance = (patch: Partial<ActivationProgress> = {}) => {
    const nextSelected = patch.selectedServices ?? progress.selectedServices;
    const next = nextStep(progress.step, nextSelected);
    go({ ...progress, ...patch, step: next, selectedServices: nextSelected, questionIndex: firstIndexFor(next) });
  };
  // Volver a un servicio desde el paso siguiente lleva a su resumen, no a la primera pregunta.
  const goBackOuter = () => {
    const previous = previousStep(progress.step, selected);
    go({ ...progress, step: previous, questionIndex: previous.startsWith('service:') ? Number.MAX_SAFE_INTEGER : 0 });
  };

  // ── Tarifas de un servicio (sub-pasos 2.1, 2.2…) ──
  const serviceName = step.startsWith('service:') ? (step.slice('service:'.length) as ActivationServiceName) : null;
  const questionnaire = serviceName ? SERVICE_QUESTIONNAIRES[serviceName] : undefined;
  const serviceAnswers: Answers = serviceName && questionnaire
    ? progress.serviceAnswers?.[serviceName] ?? questionnaire.fromConfig(data.savedServices[serviceName]?.config)
    : {};
  const questions = questionnaire ? visibleQuestions(questionnaire, serviceAnswers) : [];
  const questionIndex = Math.min(progress.questionIndex ?? 0, questions.length); // == length → resumen
  const onReview = Boolean(questionnaire) && questionIndex >= questions.length;
  const serviceConfig = questionnaire && serviceName
    ? questionnaire.toConfig(serviceAnswers, data.savedServices[serviceName]?.config)
    : null;
  const serviceValid = Boolean(questionnaire && serviceConfig && questionnaire.isValid(serviceConfig));

  const setServiceAnswer = (id: string, value: Answers[string]) => {
    if (!serviceName) return;
    go(
      { ...progress, serviceAnswers: { ...progress.serviceAnswers, [serviceName]: { ...serviceAnswers, [id]: value } } },
      { scroll: false },
    );
  };
  const setQuestionIndex = (index: number) => go({ ...progress, questionIndex: index });

  const saveService = async () => {
    if (!serviceName || !questionnaire || !serviceConfig || !serviceValid || busy) return;
    const serviceId = data.serviceIds[serviceName];
    if (!serviceId) {
      setServiceError('Este servicio no está disponible ahora mismo. Configúralo más tarde.');
      return;
    }
    setBusy(true);
    setServiceError(null);
    try {
      const wasActive = data.savedServices[serviceName]?.active ?? false;
      const ok = await saveServiceConfig(user.id, serviceId, data.serviceUnits[serviceName] ?? 'area', serviceConfig, wasActive);
      if (!ok) {
        setServiceError('No se ha podido guardar. Inténtalo de nuevo.');
        return;
      }
      setData({ ...data, savedServices: { ...data.savedServices, [serviceName]: { config: serviceConfig, active: wasActive } } });
      const rest = { ...progress.serviceAnswers };
      delete rest[serviceName];
      advance({ serviceAnswers: rest });
    } finally {
      setBusy(false);
    }
  };

  const back =
    step === 'welcome' || (step === 'finish' && finishPhase === 'done')
      ? undefined
      : questionnaire && questionIndex > 0
        ? () => setQuestionIndex(questionIndex - 1)
        : goBackOuter;

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
  } else if (step === 'schedule' && isTeam) {
    // En una cuenta de equipo el horario es de cada persona: se configura en «Horario del equipo».
    body = (
      <div>
        <h1 className="text-2xl font-bold leading-tight text-gray-900">El horario de tu equipo</h1>
        <p className="mt-2 text-gray-700">
          En una cuenta de equipo cada persona tiene su horario. Configúralo en «Horario del equipo»: los clientes solo pueden reservar cuando
          alguien trabaja.
        </p>
        <button
          type="button"
          onClick={() => navigate('/empresa/horario')}
          className="mt-4 inline-flex min-h-12 items-center rounded-xl border border-gray-300 bg-white px-4 font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          Abrir el horario del equipo
        </button>
      </div>
    );
    footer = (
      <button type="button" onClick={() => advance()} className={PRIMARY_BUTTON_CLASS}>
        Seguir
      </button>
    );
  } else if (step === 'schedule') {
    const problem = scheduleProblem(week) || (notice === null || weeksAhead === null ? 'Elige la antelación y las semanas de agenda.' : '');
    body = (
      <ScheduleStep
        week={week}
        onWeekChange={(next) => {
          setWeek(next);
          setServiceError(null);
        }}
        notice={notice}
        onNoticeChange={setNotice}
        weeksAhead={weeksAhead}
        onWeeksChange={setWeeksAhead}
        problem={serviceError ?? problem}
        showProblem={scheduleTouched || Boolean(serviceError)}
      />
    );
    footer = (
      <button
        type="button"
        disabled={busy}
        className={PRIMARY_BUTTON_CLASS}
        onClick={async () => {
          setScheduleTouched(true);
          if (problem || busy || notice === null || weeksAhead === null) return;
          setBusy(true);
          setServiceError(null);
          try {
            await saveOwnRecurringSchedule({ userId: user.id, matrix: rangesToMatrix(week), weeks: weeksAhead, minNoticeHours: notice });
            notifySetupChanged();
            setScheduleTouched(false);
            advance();
          } catch {
            setServiceError('No se ha podido guardar el horario. Inténtalo de nuevo.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
        {busy ? 'Guardando tu horario…' : 'Guardar horario y seguir'}
      </button>
    );
  } else if (serviceName === 'Servicios fitosanitarios') {
    const serviceId = data.serviceIds[serviceName];
    const wasActive = data.savedServices[serviceName]?.active ?? false;
    body = (
      <>
        <PhytoStep
          savedConfig={data.savedServices[serviceName]?.config}
          licenseStatus={setup.status?.license.status ?? null}
          registerSave={(fn) => setPhytoSave(() => fn)}
          onSave={async (config) => {
            if (!serviceId) return false;
            const ok = await saveServiceConfig(user.id, serviceId, data.serviceUnits[serviceName] ?? 'area', config as unknown as Record<string, unknown>, wasActive);
            if (ok) setData({ ...data, savedServices: { ...data.savedServices, [serviceName]: { config, active: wasActive } } });
            return ok;
          }}
        />
        {serviceError && <p role="alert" className="mt-3 text-sm text-red-700">{serviceError}</p>}
        <button
          type="button"
          onClick={() => advance()}
          className="mt-6 inline-flex min-h-11 items-center rounded text-sm font-semibold text-gray-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
        >
          Configurar fitosanitarios más tarde
        </button>
      </>
    );
    footer = (
      <button
        type="button"
        disabled={busy || !phytoSave}
        className={PRIMARY_BUTTON_CLASS}
        onClick={async () => {
          if (!phytoSave || busy) return;
          setBusy(true);
          setServiceError(null);
          try {
            const result = await phytoSave();
            if (result === 'success') advance();
            else setServiceError(result === 'invalid' ? 'Revisa los campos marcados en rojo: faltan tarifas o rendimientos.' : 'No se ha podido guardar. Inténtalo de nuevo.');
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
        {busy ? 'Guardando…' : 'Guardar y seguir'}
      </button>
    );
  } else if (serviceName && questionnaire) {
    const short = serviceInfo(serviceName).short;
    const skip = (
      <button
        type="button"
        onClick={() => advance()}
        className="mt-6 inline-flex min-h-11 items-center rounded text-sm font-semibold text-gray-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
      >
        Configurar {short.toLowerCase()} más tarde
      </button>
    );
    if (onReview) {
      body = (
        <>
          <ServiceReview
            questionnaire={questionnaire}
            answers={serviceAnswers}
            previews={serviceValid && serviceConfig ? previewQuotes(questionnaire, serviceConfig) : []}
            valid={serviceValid}
            onEdit={setQuestionIndex}
          />
          {serviceError && <p role="alert" className="mt-3 text-sm text-red-700">{serviceError}</p>}
          {skip}
        </>
      );
      footer = (
        <button type="button" onClick={() => void saveService()} disabled={!serviceValid || busy} className={PRIMARY_BUTTON_CLASS}>
          {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {busy ? 'Guardando…' : 'Guardar y seguir'}
        </button>
      );
    } else {
      const question = questions[questionIndex];
      body = (
        <>
          <QuestionScreen
            question={question}
            answers={serviceAnswers}
            onChange={setServiceAnswer}
            position={`${short} · ${questionIndex + 1} de ${questionCountUpperBound(questionnaire, serviceAnswers)}`}
          />
          {skip}
        </>
      );
      footer = (
        <button
          type="button"
          onClick={() => setQuestionIndex(questionIndex + 1)}
          disabled={!isQuestionAnswered(question, serviceAnswers)}
          className={PRIMARY_BUTTON_CLASS}
        >
          Siguiente
        </button>
      );
    }
  } else if (step === 'team') {
    const needsLiability = !isTeam;
    const sendInvitations = async () => {
      setServiceError(null);
      if (team.answer !== 'yes') {
        advance();
        return;
      }
      const errors: Record<number, string> = {};
      const seen = new Set(sentInvites.map((s) => s.email.toLowerCase()));
      const toSend: Array<{ email: string; index: number }> = [];
      team.emails.forEach((raw, index) => {
        const email = raw.trim();
        if (!email) return;
        const preset = team.presets[index];
        if (!looksLikeEmail(email)) errors[index] = 'Este correo no parece válido.';
        else if (preset && presetProblem(preset)) errors[index] = presetProblem(preset);
        else if (seen.has(email.toLowerCase())) errors[index] = 'Este correo está repetido.';
        else {
          seen.add(email.toLowerCase());
          toSend.push({ email, index });
        }
      });
      if (Object.keys(errors).length > 0) {
        setEmailErrors(errors);
        return;
      }
      if (toSend.length === 0) {
        if (sentInvites.length > 0) advance();
        else setEmailErrors({ 0: 'Escribe al menos un correo, o elige que trabajas solo.' });
        return;
      }
      if (needsLiability && !team.declared) {
        setServiceError('Para invitar a tu equipo, marca la declaración del seguro.');
        return;
      }
      setBusy(true);
      const sent: TeamInvitationResult[] = [];
      const failed: Record<number, string> = {};
      let presetFailed = false;
      for (const { email, index } of toSend) {
        let result: TeamInvitationResult;
        try {
          result = await createTeamInvitation(email, needsLiability);
        } catch (error) {
          failed[index] = (error as { message?: string })?.message || 'No se ha podido invitar a este correo.';
          continue;
        }
        sent.push(result);
        const preset = team.presets[index];
        if (preset) {
          try {
            await setInvitationPreset(result.invitationId, preset);
          } catch {
            // La invitación ya salió: su configuración se podrá hacer en «Equipo» cuando acepte.
            presetFailed = true;
          }
        }
      }
      if (presetFailed) setServiceError('Las invitaciones se enviaron, pero alguna configuración no se guardó: hazla en «Equipo» cuando acepten.');
      setBusy(false);
      setSentInvites((prev) => [...prev, ...sent]);
      // Quedan solo los correos que fallaron, para corregirlos.
      const remainingSend = toSend.filter(({ index }) => failed[index]);
      const remaining = remainingSend.map(({ email }) => email);
      setTeam({
        ...team,
        emails: remaining.length > 0 ? remaining : [''],
        presets: remaining.length > 0 ? remainingSend.map(({ index }) => team.presets[index] ?? null) : [null],
      });
      setEmailErrors(Object.fromEntries(toSend.filter(({ index }) => failed[index]).map(({ index }, i) => [i, failed[index]])));
      if (remaining.length === 0 && !presetFailed) advance();
    };
    body = (
      <>
        <TeamStep
          value={team}
          onChange={(next) => {
            setTeam(next);
            setEmailErrors({});
            setServiceError(null);
          }}
          isTeam={isTeam}
          needsLiability={needsLiability}
          emailErrors={emailErrors}
          sent={sentInvites}
          serviceOptions={selected
            .filter((name) => name !== 'Servicios fitosanitarios' && data.savedServices[name] && data.serviceIds[name])
            .map((name) => ({ id: data.serviceIds[name]!, name }))}
          offersPhyto={selected.includes('Servicios fitosanitarios') || Boolean(data.savedServices['Servicios fitosanitarios']?.active)}
        />
        {serviceError && <p role="alert" className="mt-3 text-sm text-red-700">{serviceError}</p>}
      </>
    );
    footer = (
      <button type="button" onClick={() => void sendInvitations()} disabled={busy || team.answer === null} className={PRIMARY_BUTTON_CLASS}>
        {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
        {team.answer === 'yes' ? (busy ? 'Enviando invitaciones…' : 'Enviar invitaciones y seguir') : 'Seguir'}
      </button>
    );
  } else if (step === 'finish') {
    const readyNames = selected.filter((name) => isSavedServiceConfigValid(name, data.savedServices[name]?.config));
    const summary = {
      zone: data.hasCoordinates ? `${placeLabel(data.address) || data.address} · ${data.maxDistance} km` : null,
      services: selected.map((name) => ({ name, ready: readyNames.includes(name) })),
      weeklyHours: weeklyHours(week),
      invitations: sentInvites.length,
    };
    const pendingSteps = setup.status ? buildProviderSetupSteps(setup.status).required.filter((s) => s.state !== 'done') : [];
    const activate = async () => {
      if (busy || readyNames.length === 0) return;
      setBusy(true);
      setServiceError(null);
      try {
        const nextSaved = { ...data.savedServices };
        for (const name of readyNames) {
          const serviceId = data.serviceIds[name];
          if (!serviceId || nextSaved[name]?.active) continue;
          await setServiceActive(user.id, serviceId, true);
          nextSaved[name] = { config: nextSaved[name]?.config, active: true };
        }
        setData({ ...data, savedServices: nextSaved });
        notifySetupChanged();
        await setup.refresh();
        clearActivationProgress(user.id);
        setFinishPhase('done');
        window.scrollTo({ top: 0 });
      } catch {
        setServiceError('No se han podido activar tus servicios. Inténtalo de nuevo.');
      } finally {
        setBusy(false);
      }
    };
    body = (
      <>
        <FinishStep phase={finishPhase} firstName={data.firstName} summary={summary} pending={pendingSteps} providerId={user.id} />
        {serviceError && <p role="alert" className="mt-3 text-sm text-red-700">{serviceError}</p>}
      </>
    );
    footer =
      finishPhase === 'review' ? (
        <button type="button" onClick={() => void activate()} disabled={busy || readyNames.length === 0} className={PRIMARY_BUTTON_CLASS}>
          {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />}
          {busy ? 'Activando…' : 'Activar mi cuenta'}
        </button>
      ) : (
        <button type="button" onClick={() => navigate(home)} className={PRIMARY_BUTTON_CLASS}>
          Ir a mi panel
        </button>
      );
  } else {
    // Un servicio sin preguntas (no debería pasar): se sigue sin bloquear.
    body = (
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{serviceName ?? ''}</h1>
        <p className="mt-2 text-gray-600">Este servicio se configura en «Mi perfil → Servicios».</p>
      </div>
    );
    footer = (
      <button type="button" onClick={() => advance()} className={PRIMARY_BUTTON_CLASS}>
        Seguir
      </button>
    );
  }

  return (
    <ActivationShell
      stepLabel={stepLabel}
      percent={percent}
      onBack={back}
      onPause={step === 'finish' && finishPhase === 'done' ? undefined : pause}
      footer={footer}
    >
      {body}
    </ActivationShell>
  );
};

export default ActivationWizardPage;
