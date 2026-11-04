import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, History, Loader2, Percent, RotateCcw, Save } from 'lucide-react';
import {
  CommissionSettingsError,
  fetchCommissionAudit,
  fetchCommissionSettings,
  saveCommissionSettings,
  type CommissionAuditEntry,
  type CommissionSettings as CommissionSettingsData,
} from '../../config/commissionSettings';
import {
  COMMISSION_RULES,
  COMMISSION_RULE_CODES,
  formatCommissionPercent,
  readCommissionPercent,
  type CommissionRates,
  type CommissionRuleCode,
} from '../../shared/commissionRules';

/**
 * Configuración de comisiones: lo que cobra GarSer en cada tipo de reserva.
 *
 * Esta pantalla solo EDITA y MUESTRA. Quién puede verla o guardar lo decide la base de datos
 * (is_admin() dentro de las RPC) y qué porcentaje se aplica a cada reserva lo decide el servidor
 * al firmar el presupuesto: el navegador no puede cambiar ninguna de las dos cosas.
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; settings: CommissionSettingsData };

type Notice =
  | { kind: 'success'; settings: CommissionSettingsData; changed: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'stale'; message: string; current: CommissionSettingsData | null };

type AuditState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: CommissionAuditEntry[] };

type Drafts = Record<CommissionRuleCode, string>;

const toDrafts = (rates: CommissionRates): Drafts =>
  Object.fromEntries(COMMISSION_RULE_CODES.map((code) => [code, formatCommissionPercent(rates[code])])) as Drafts;

// Espacio duro entre el número y «%»: que un «%» suelto no quede solo al principio de una línea.
const percentLabel = (value: number) => `${formatCommissionPercent(value)}\u00a0%`;

const formatDateTime = (iso: string | null) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
};

const ruleTitle = (code: CommissionRuleCode) => COMMISSION_RULES.find((rule) => rule.code === code)?.shortTitle ?? code;

const OUTCOME_LABEL: Record<CommissionAuditEntry['outcome'], string> = {
  saved: 'Guardado',
  no_change: 'Sin cambios',
  rejected: 'Rechazado',
  stale: 'Versión desfasada',
};

/** «Primera reserva (GarSer): 12,5 % → 14 %» por cada regla que cambió. */
function describeAuditChanges(entry: CommissionAuditEntry): string[] {
  if (entry.outcome !== 'saved' || !entry.savedRates) return [];
  const lines: string[] = [];
  for (const code of COMMISSION_RULE_CODES) {
    const after = entry.savedRates[code];
    if (after === undefined) continue;
    const before = entry.previousRates?.[code];
    if (entry.previousRates === null) lines.push(`${ruleTitle(code)}: ${percentLabel(after)}`);
    else if (before !== after) lines.push(`${ruleTitle(code)}: ${before === undefined ? '' : `${percentLabel(before)} → `}${percentLabel(after)}`);
  }
  return lines;
}

const CommissionSettingsPage: React.FC = () => {
  const baseId = useId();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [touched, setTouched] = useState<Partial<Record<CommissionRuleCode, boolean>>>({});
  const [serverErrors, setServerErrors] = useState<Partial<Record<CommissionRuleCode, string>>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [audit, setAudit] = useState<AuditState>({ status: 'loading' });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadAudit = useCallback(() => {
    fetchCommissionAudit(10)
      .then((entries) => {
        if (mountedRef.current) setAudit({ status: 'ready', entries });
      })
      .catch(() => {
        if (mountedRef.current) setAudit({ status: 'error' });
      });
  }, []);

  const loadSettings = useCallback(() => {
    setLoad({ status: 'loading' });
    setNotice(null);
    fetchCommissionSettings()
      .then((settings) => {
        if (!mountedRef.current) return;
        setLoad({ status: 'ready', settings });
        setDrafts(toDrafts(settings.rates));
        setTouched({});
        setServerErrors({});
        setSubmitAttempted(false);
        loadAudit();
      })
      .catch((error) => {
        if (!mountedRef.current) return;
        setLoad({
          status: 'error',
          message: error instanceof CommissionSettingsError ? error.message : 'No se pudieron cargar las comisiones.',
        });
      });
  }, [loadAudit]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const persisted = load.status === 'ready' ? load.settings : null;

  // Lo que dicen los campos, regla a regla. Un campo vacío o raro es un error, nunca un 0.
  const readings = useMemo(
    () =>
      drafts
        ? (Object.fromEntries(COMMISSION_RULE_CODES.map((code) => [code, readCommissionPercent(drafts[code])])) as Record<
            CommissionRuleCode,
            ReturnType<typeof readCommissionPercent>
          >)
        : null,
    [drafts],
  );

  const changes = useMemo(() => {
    if (!persisted || !readings) return [];
    return COMMISSION_RULE_CODES.filter((code) => {
      const reading = readings[code];
      return reading.ok && Math.round(reading.value * 100) !== Math.round(persisted.rates[code] * 100);
    });
  }, [persisted, readings]);

  const hasInvalid = readings ? COMMISSION_RULE_CODES.some((code) => !readings[code].ok) : false;
  const dirty = changes.length > 0 || hasInvalid;
  const canSave = Boolean(persisted) && !saving && changes.length > 0 && !hasInvalid;

  const errorFor = (code: CommissionRuleCode): string | null => {
    const server = serverErrors[code];
    if (server) return server;
    const reading = readings?.[code];
    if (reading && !reading.ok && (touched[code] || submitAttempted)) return reading.message;
    return null;
  };

  const handleChange = (code: CommissionRuleCode, value: string) => {
    setDrafts((previous) => (previous ? { ...previous, [code]: value } : previous));
    setServerErrors((previous) => {
      if (!previous[code]) return previous;
      const { [code]: _removed, ...rest } = previous;
      void _removed;
      return rest;
    });
    // Un aviso de «guardado» o de error deja de decir la verdad en cuanto se vuelve a editar.
    setNotice((previous) => (previous && previous.kind !== 'stale' ? null : previous));
  };

  const handleDiscard = () => {
    if (!persisted) return;
    setDrafts(toDrafts(persisted.rates));
    setTouched({});
    setServerErrors({});
    setSubmitAttempted(false);
    setNotice(null);
  };

  const applyServerSettings = (settings: CommissionSettingsData) => {
    setLoad({ status: 'ready', settings });
    setDrafts(toDrafts(settings.rates));
    setTouched({});
    setServerErrors({});
    setSubmitAttempted(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Dos clics (o un clic y un Intro) no pueden lanzar dos escrituras.
    if (savingRef.current || !persisted || !drafts || !readings) return;

    if (hasInvalid) {
      setSubmitAttempted(true);
      const firstInvalid = COMMISSION_RULE_CODES.find((code) => !readings[code].ok);
      if (firstInvalid) document.getElementById(`${baseId}-${firstInvalid}`)?.focus();
      return;
    }
    if (changes.length === 0) return;

    const rates = Object.fromEntries(
      COMMISSION_RULE_CODES.map((code) => {
        const reading = readings[code];
        return [code, reading.ok ? reading.value : 0];
      }),
    ) as CommissionRates;

    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    setServerErrors({});
    try {
      const result = await saveCommissionSettings(persisted.version, rates);
      if (!mountedRef.current) return;
      // Se enseña lo que el servidor devuelve, no lo que se escribió.
      applyServerSettings(result.settings);
      setNotice({ kind: 'success', settings: result.settings, changed: result.changed });
      loadAudit();
    } catch (error) {
      if (!mountedRef.current) return;
      // Los valores escritos se conservan en todos los casos para poder corregirlos.
      if (error instanceof CommissionSettingsError) {
        if (error.code === 'invalid') {
          setServerErrors(error.fieldErrors);
          setNotice({ kind: 'error', message: 'El servidor no ha guardado nada. Revisa los porcentajes marcados.' });
        } else if (error.code === 'stale') {
          setNotice({ kind: 'stale', message: error.message, current: error.current });
        } else {
          setNotice({ kind: 'error', message: `No se ha guardado nada. ${error.message}` });
        }
      } else {
        setNotice({ kind: 'error', message: 'No se ha guardado nada. Inténtalo de nuevo en unos minutos.' });
      }
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h2 className="flex items-center gap-2 border-b pb-2 text-xl font-bold text-gray-900">
          <Percent className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          Configuración de comisiones
        </h2>
        <p className="mt-3 text-sm text-gray-600">
          Porcentaje de gastos de gestión que paga el cliente sobre el precio del servicio (IVA incluido). El profesional
          cobra el 100 % de su precio. El servidor elige la regla que corresponde a cada reserva; aquí solo se decide
          cuánto vale cada una.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Los cambios se aplican a los presupuestos que se generen a partir de ahora. Las reservas ya creadas y los
          presupuestos ya firmados conservan el porcentaje con el que se calcularon.
        </p>
      </header>

      {load.status === 'loading' && (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-600" role="status">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Cargando la configuración de comisiones…
        </div>
      )}

      {load.status === 'error' && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-5" role="alert">
          <p className="flex items-start gap-2 text-sm font-medium text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{load.message} No se muestra ningún porcentaje porque no se han podido leer del servidor.</span>
          </p>
          <button
            type="button"
            onClick={loadSettings}
            className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reintentar
          </button>
        </div>
      )}

      {persisted && drafts && readings && (
        <form onSubmit={handleSubmit} noValidate className="space-y-5" aria-busy={saving}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
            <span className="font-medium text-gray-800">Versión {persisted.version}</span>
            {persisted.updatedAt && <span>Actualizada el {formatDateTime(persisted.updatedAt)}</span>}
          </div>

          {persisted.lastQuoteUsesCommissions === false && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>
                El último presupuesto firmado <strong>no usa estas comisiones</strong>: el servidor sigue con el sistema
                anterior. Si acabas de aplicar la migración, faltan por desplegar las funciones{' '}
                <code className="rounded bg-amber-100 px-1">booking-authority</code> y{' '}
                <code className="rounded bg-amber-100 px-1">booking-payment</code>. Hasta entonces, lo que guardes aquí
                no cambia lo que pagan los clientes.
              </p>
            </div>
          )}
          {persisted.lastQuoteUsesCommissions === null && (
            <p className="text-xs text-gray-500">Todavía no se ha firmado ningún presupuesto con esta configuración.</p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {COMMISSION_RULES.map((rule) => {
              const inputId = `${baseId}-${rule.code}`;
              const error = errorFor(rule.code);
              const isChanged = changes.includes(rule.code);
              return (
                <section
                  key={rule.code}
                  aria-labelledby={`${inputId}-title`}
                  className={`rounded-xl border bg-white p-5 shadow-sm ${isChanged ? 'border-emerald-400' : 'border-gray-200'}`}
                >
                  <h3 id={`${inputId}-title`} className="text-sm font-semibold text-gray-900">
                    {rule.title}
                  </h3>
                  <p id={`${inputId}-description`} className="mt-1 text-sm text-gray-600">
                    {rule.description}
                  </p>
                  <div className="mt-4">
                    <label htmlFor={inputId} className="block text-xs font-medium text-gray-700">
                      Porcentaje
                    </label>
                    <div className="relative mt-1">
                      <input
                        id={inputId}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        value={drafts[rule.code]}
                        onChange={(event) => handleChange(rule.code, event.target.value)}
                        onBlur={() => setTouched((previous) => ({ ...previous, [rule.code]: true }))}
                        disabled={saving}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={`${inputId}-description ${inputId}-saved${error ? ` ${inputId}-error` : ''}`}
                        className={`min-h-[44px] w-full rounded-lg border px-3 py-2 pr-9 text-base tabular-nums outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-500 ${
                          error
                            ? 'border-red-400 focus:border-red-500 focus:ring-red-500'
                            : 'border-gray-300 focus:border-green-500 focus:ring-green-500'
                        }`}
                      />
                      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-gray-500">
                        %
                      </span>
                    </div>
                    <p id={`${inputId}-saved`} className="mt-1.5 text-xs text-gray-500">
                      Valor guardado: <strong className="text-gray-700">{percentLabel(persisted.rates[rule.code])}</strong>
                      {isChanged && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 font-medium text-emerald-800">Sin guardar</span>
                      )}
                    </p>
                    {error && (
                      <p id={`${inputId}-error`} role="alert" className="mt-1 text-sm font-medium text-red-700">
                        {error}
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

          {changes.length > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              <p className="font-semibold">Cambios pendientes de guardar</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {changes.map((code) => {
                  const reading = readings[code];
                  return (
                    <li key={code}>
                      {ruleTitle(code)}: {percentLabel(persisted.rates[code])} → {reading.ok ? percentLabel(reading.value) : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div aria-live="polite" className="space-y-3">
            {notice?.kind === 'success' && (
              <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
                <p className="flex items-start gap-2 font-semibold">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {notice.changed
                    ? `Configuración guardada (versión ${notice.settings.version}). Ya se aplica a los presupuestos nuevos.`
                    : `No había nada que cambiar: estos valores ya estaban guardados (versión ${notice.settings.version}).`}
                </p>
                <ul className="mt-2 list-disc space-y-0.5 pl-5">
                  {COMMISSION_RULE_CODES.map((code) => (
                    <li key={code}>
                      {ruleTitle(code)}: {percentLabel(notice.settings.rates[code])}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {notice?.kind === 'error' && (
              <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{notice.message}</p>
              </div>
            )}
            {notice?.kind === 'stale' && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900" role="alert">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {notice.message} No se ha guardado nada y tus valores siguen escritos.
                </p>
                <button
                  type="button"
                  onClick={() => (notice.current ? (applyServerSettings(notice.current), setNotice(null)) : loadSettings())}
                  className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Cargar los valores actuales
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-end">
            {dirty && !saving && (
              <button
                type="button"
                onClick={handleDiscard}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Descartar cambios
              </button>
            )}
            <button
              type="submit"
              disabled={!canSave}
              aria-disabled={!canSave}
              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              {saving ? 'Guardando…' : 'Guardar configuración'}
            </button>
          </div>
        </form>
      )}

      {persisted && (
        <section aria-labelledby={`${baseId}-audit-title`} className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <details>
            <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 px-5 py-3 text-sm font-semibold text-gray-900">
              <History className="h-4 w-4 text-gray-500" aria-hidden="true" />
              <span id={`${baseId}-audit-title`}>Historial de cambios</span>
            </summary>
            <div className="border-t border-gray-100 px-5 py-4 text-sm">
              {audit.status === 'loading' && <p className="text-gray-500">Cargando el historial…</p>}
              {audit.status === 'error' && (
                <p className="text-gray-600">No se ha podido cargar el historial. Los porcentajes de arriba no se ven afectados.</p>
              )}
              {audit.status === 'ready' && audit.entries.length === 0 && <p className="text-gray-500">Todavía no hay cambios.</p>}
              {audit.status === 'ready' && audit.entries.length > 0 && (
                <ol className="space-y-3">
                  {audit.entries.map((entry) => {
                    const changesText = describeAuditChanges(entry);
                    const who = entry.source === 'migration' ? 'Valores iniciales' : entry.actorName || (entry.actorId ? 'Administrador' : 'Acceso directo a la base de datos');
                    return (
                      <li key={entry.id} className="border-l-2 border-gray-200 pl-3">
                        <p className="text-gray-800">
                          <span className="font-medium">{OUTCOME_LABEL[entry.outcome]}</span>
                          {entry.newVersion !== null && entry.outcome === 'saved' ? ` · versión ${entry.newVersion}` : ''}
                          {' · '}
                          {who}
                        </p>
                        <p className="text-xs text-gray-500">{formatDateTime(entry.occurredAt)}</p>
                        {changesText.length > 0 && (
                          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-gray-700">
                            {changesText.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </details>
        </section>
      )}
    </div>
  );
};

export default CommissionSettingsPage;
