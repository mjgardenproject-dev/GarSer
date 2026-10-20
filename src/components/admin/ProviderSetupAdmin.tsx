import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Mail, Phone, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  buildProviderSetupSteps,
  type ProviderSetupStatus,
  type ProviderSetupSummary,
  type SetupStep,
} from '../../shared/providerSetup';
import { SetupStepList } from '../provider/ProviderSetupChecklist';

// Admin · Profesionales (2026-10-20): qué profesionales aprobados todavía no salen a los clientes y
// qué le falta a cada uno. Mismo estado (admin_provider_setup_overview) y mismos pasos
// (buildProviderSetupSteps) que ve el profesional en su panel: el admin y él ven lo mismo.

export interface AdminProviderRow {
  user_id: string;
  name: string | null;
  provider_kind: 'solo' | 'company';
  email: string | null;
  phone: string | null;
  approved_at: string;
  status: ProviderSetupStatus | null;
}

export type ProviderCategory = 'hidden' | 'pending' | 'complete';
type Filter = 'hidden' | 'missing' | 'all';

export interface AdminProviderEntry extends AdminProviderRow {
  summary: ProviderSetupSummary | null;
  category: ProviderCategory;
}

const CATEGORY_ORDER: Record<ProviderCategory, number> = { hidden: 0, pending: 1, complete: 2 };

/** No sale a ningún cliente / sale pero le falta algo obligatorio / completo. */
export function categorize(summary: ProviderSetupSummary | null): ProviderCategory {
  if (!summary || summary.suspended || summary.visibleServices.length === 0) return 'hidden';
  return summary.allRequiredDone ? 'complete' : 'pending';
}

/** Primero los que no salen, luego los que tienen algo pendiente; dentro, los más recientes. */
export function buildAdminProviderEntries(rows: AdminProviderRow[]): AdminProviderEntry[] {
  return rows
    .map((row) => {
      const summary = row.status ? buildProviderSetupSteps(row.status) : null;
      return { ...row, summary, category: categorize(summary) };
    })
    .sort((a, b) =>
      CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]
      || new Date(b.approved_at).getTime() - new Date(a.approved_at).getTime());
}

const missingLabel = (step: SetupStep) => {
  if (step.state === 'review') return `${step.title} (en revisión)`;
  if (step.state === 'warning') return `${step.title} (revisar)`;
  return step.title;
};

function daysSince(iso: string): string {
  const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  if (days === 0) return 'Alta hoy';
  return `Alta hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

const ProviderRow: React.FC<{ entry: AdminProviderEntry }> = ({ entry }) => {
  const [open, setOpen] = useState(false);
  const { summary } = entry;
  const missing = (summary?.required ?? []).filter((s) => s.state !== 'done' && s.state !== 'blocked');
  const extras = (summary?.recommended ?? []).filter((s) => s.state !== 'done');
  const name = entry.name || entry.email || 'Profesional sin nombre';

  let statusLine: React.ReactNode;
  if (!summary) {
    statusLine = <span className="text-red-700">Sin ficha de profesional</span>;
  } else if (summary.suspended) {
    statusLine = <span className="text-red-700">Cuenta suspendida: no aparece</span>;
  } else if (summary.visibleServices.length === 0) {
    statusLine = <span className="font-semibold text-amber-800">No aparece a los clientes</span>;
  } else {
    statusLine = <span className="text-emerald-800">Aparece en {summary.visibleServices.join(', ')}</span>;
  }

  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold text-gray-900">
            {name}
            <span className="ml-2 inline-flex rounded-full bg-gray-100 px-2 py-0.5 align-middle text-xs font-medium text-gray-600">
              {entry.provider_kind === 'company' ? 'Empresa' : 'Jardinero'}
            </span>
          </p>
          <p className="mt-0.5 text-sm">{statusLine}</p>
        </div>
        <span className="shrink-0 text-xs text-gray-500">{daysSince(entry.approved_at)}</span>
      </div>

      {missing.length > 0 && (
        <p className="mt-2 text-sm text-gray-800">
          <span className="font-medium">Le falta:</span> {missing.map(missingLabel).join(', ')}
        </p>
      )}
      {extras.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">Recomendado: {extras.map((s) => s.title).join(', ')}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {entry.phone && (
          <a href={`tel:${entry.phone}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50">
            <Phone className="h-4 w-4" aria-hidden="true" /> Llamar
          </a>
        )}
        {entry.email && (
          <a
            href={`mailto:${entry.email}?subject=${encodeURIComponent('Tu cuenta de GarSer')}`}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            <Mail className="h-4 w-4" aria-hidden="true" /> Escribir
          </a>
        )}
        {summary && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-50"
          >
            Ver pasos <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && summary && (
        <div className="mt-2 -mx-3">
          <SetupStepList steps={[...summary.required, ...summary.recommended]} label={`Pasos de ${name}`} />
        </div>
      )}
    </li>
  );
};

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'hidden', label: 'No aparecen' },
  { key: 'missing', label: 'Les falta algo' },
  { key: 'all', label: 'Todos' },
];

const ProviderSetupAdmin: React.FC = () => {
  const [rows, setRows] = useState<AdminProviderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('hidden');

  const load = async () => {
    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('admin_provider_setup_overview');
    if (rpcError) {
      setError(rpcError.message || 'No se ha podido cargar la lista.');
    } else {
      setRows((data ?? []) as unknown as AdminProviderRow[]);
      setError(null);
    }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const entries = useMemo(() => buildAdminProviderEntries(rows ?? []), [rows]);
  const counts = useMemo(() => ({
    total: entries.length,
    visible: entries.filter((e) => e.category !== 'hidden').length,
    hidden: entries.filter((e) => e.category === 'hidden').length,
    missing: entries.filter((e) => e.category !== 'complete').length,
  }), [entries]);
  const shown = entries.filter((e) => (filter === 'all' ? true : filter === 'hidden' ? e.category === 'hidden' : e.category !== 'complete'));

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profesionales</h1>
          <p className="mt-1 text-gray-600">
            Quién sale a los clientes y qué le falta a cada uno, con las mismas reglas que la reserva (próximos 14 días).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" /> Actualizar
        </button>
      </header>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {rows && (
        <>
          <p className="text-sm text-gray-700" aria-live="polite">
            <span className="font-semibold text-gray-900">{counts.total}</span> aprobados ·{' '}
            <span className="font-semibold text-emerald-800">{counts.visible}</span> aparecen ·{' '}
            <span className="font-semibold text-amber-800">{counts.hidden}</span> todavía no
          </p>

          <div role="tablist" aria-label="Filtrar profesionales" className="inline-flex flex-wrap gap-1 rounded-xl bg-gray-100 p-1">
            {FILTERS.map(({ key, label }) => {
              const n = key === 'hidden' ? counts.hidden : key === 'missing' ? counts.missing : counts.total;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={filter === key}
                  onClick={() => setFilter(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${filter === key ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600'}`}
                >
                  {label} ({n})
                </button>
              );
            })}
          </div>

          {shown.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-600">
              {filter === 'hidden' ? 'Todos los profesionales aprobados aparecen a los clientes.' : 'No hay profesionales en esta lista.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {shown.map((entry) => <ProviderRow key={entry.user_id} entry={entry} />)}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default ProviderSetupAdmin;
