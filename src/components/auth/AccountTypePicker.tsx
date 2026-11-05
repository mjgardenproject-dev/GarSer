import React from 'react';
import { Briefcase, Building2, ChevronRight, Loader2, User, type LucideIcon } from 'lucide-react';

// Las tres formas de usar GarSer (2026-11-04). Una sola lista, usada en el registro (/auth) y en la
// pregunta que sale al crearse una cuenta nueva con Google sin haber elegido: así los textos y el
// orden no se pueden descuadrar entre un sitio y otro.

export type AccountType = 'client' | 'gardener' | 'company';

export const ACCOUNT_TYPES: Record<AccountType, { title: string; description: string; Icon: LucideIcon; nounPhrase: string }> = {
  client: {
    title: 'Cliente',
    description: 'Quiero contratar jardinería para mi casa o comunidad',
    Icon: User,
    nounPhrase: 'cliente',
  },
  gardener: {
    title: 'Jardinero',
    description: 'Trabajo por mi cuenta y quiero conseguir clientes',
    Icon: Briefcase,
    nounPhrase: 'jardinero',
  },
  company: {
    title: 'Empresa',
    description: 'Tengo una empresa con un equipo de jardinería',
    Icon: Building2,
    nounPhrase: 'empresa',
  },
};

export const isAccountType = (value: unknown): value is AccountType =>
  value === 'client' || value === 'gardener' || value === 'company';

interface Props {
  types?: AccountType[];
  onSelect: (type: AccountType) => void;
  /** Tipo que se está procesando: enseña la ruedecita y bloquea el resto. */
  busyType?: AccountType | null;
  disabled?: boolean;
}

/** Filas grandes y tocables (≥ 64 px): elegir una avanza de pantalla, sin botón «Continuar». */
const AccountTypePicker: React.FC<Props> = ({ types = ['client', 'gardener', 'company'], onSelect, busyType = null, disabled = false }) => (
  <ul className="space-y-2.5">
    {types.map((type) => {
      const { title, description, Icon } = ACCOUNT_TYPES[type];
      const busy = busyType === type;
      return (
        <li key={type}>
          <button
            type="button"
            onClick={() => onSelect(type)}
            disabled={disabled || busyType !== null}
            className="group flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border border-gray-200 bg-white p-3 text-left transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 active:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60 [touch-action:manipulation]"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100">
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Icon className="h-5 w-5" aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-semibold text-gray-900">{title}</span>
              <span className="block text-sm leading-snug text-gray-600">{description}</span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
          </button>
        </li>
      );
    })}
  </ul>
);

export default AccountTypePicker;
