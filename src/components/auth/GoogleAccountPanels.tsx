import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import {
  accountRoleLabel,
  declareSignupRoleIfNeeded,
  type OAuthSignInResult,
  type RoleProblem,
} from '../../lib/oauthAccount';
import AccountTypePicker, { ACCOUNT_TYPES, parseAccountType, type AccountType } from './AccountTypePicker';

// Pantallas que salen DESPUÉS de entrar con Google cuando hay que aclarar algo (2026-11-04). Las usan
// el acceso (AuthForm) y la vuelta por redirección (AuthCallbackPage), para que no se diga una cosa
// en un sitio y otra en otro.
//
//  · NewAccountChooser: Google crea cuenta con solo pulsar un botón, y la cuenta nace de cliente.
//    Quien entró desde «Entrar» sin haber elegido (un jardinero despistado, sobre todo) no puede
//    quedarse como cliente sin saberlo: se le pregunta antes de seguir.
//  · RoleProblemPanel: eligió profesional y no se ha podido dejar así. Se dice por qué y qué
//    hacer, en vez de llevarle al panel de cliente como si nada.

const useFocusOnMount = (ref: React.RefObject<HTMLElement>) => {
  useEffect(() => { ref.current?.focus(); }, [ref]);
};

const PRIMARY = 'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-base font-bold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60 [touch-action:manipulation]';
const SECONDARY = 'inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-gray-300 bg-white px-4 text-base font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:opacity-60 [touch-action:manipulation]';

interface ChooserProps {
  result: OAuthSignInResult;
  /** Cuando ya está elegido (y, si era profesional, declarado). Puede traer `roleProblem`. */
  onResolved: (result: OAuthSignInResult) => void;
}

export const NewAccountChooser: React.FC<ChooserProps> = ({ result, onResolved }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [busyType, setBusyType] = useState<AccountType | null>(null);
  useFocusOnMount(headingRef);

  const choose = async (type: AccountType) => {
    if (type === 'client') {
      onResolved(result);
      return;
    }
    setBusyType(type);
    try {
      onResolved(await declareSignupRoleIfNeeded(result, type));
    } finally {
      setBusyType(null);
    }
  };

  return (
    <section aria-labelledby="new-account-title" className="space-y-5">
      <div className="text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 id="new-account-title" ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-bold text-gray-900 outline-none">
          {result.firstName ? `Te damos la bienvenida, ${result.firstName}` : 'Te damos la bienvenida'}
        </h1>
        <p className="mt-1 text-base text-gray-600">Hemos creado tu cuenta. ¿Cómo vas a usar GarSer?</p>
      </div>
      <AccountTypePicker onSelect={(type) => void choose(type)} busyType={busyType} />
      <p className="text-center text-sm text-gray-500">Después no podrás cambiar el tipo de cuenta.</p>
    </section>
  );
};

const problemCopy = (problem: RoleProblem, requested: string, current: string): { title: string; body: string } => {
  switch (problem) {
    case 'has_activity':
      return {
        title: 'Este correo ya tiene una cuenta de cliente',
        body: `Tiene reservas o solicitudes, así que no se puede convertir en una cuenta de ${requested}. Para trabajar en GarSer, crea la cuenta con otro correo de Google.`,
      };
    case 'other_role':
      return {
        title: `Este correo ya tiene una cuenta de ${current}`,
        body: 'Cada correo tiene un solo tipo de cuenta y no se puede cambiar. Entra con ella o usa otro correo de Google.',
      };
    default:
      return {
        title: `No hemos podido crear tu cuenta de ${requested}`,
        body: 'Has entrado con Google, pero no hemos podido dejar tu cuenta con ese tipo. Vuelve a intentarlo.',
      };
  }
};

interface ProblemProps {
  result: OAuthSignInResult;
  onResolved: (result: OAuthSignInResult) => void;
  /** Seguir con la cuenta tal y como está (la que ya tenía). */
  onContinue: () => void;
  /** Cerrar la sesión de Google para probar con otro correo. */
  onSwitchAccount: () => Promise<void> | void;
}

export const RoleProblemPanel: React.FC<ProblemProps> = ({ result, onResolved, onContinue, onSwitchAccount }) => {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  useFocusOnMount(headingRef);

  const problem = result.roleProblem ?? 'failed';
  const requested = ACCOUNT_TYPES[parseAccountType(result.requestedRole) ?? 'gardener'].nounPhrase;
  const copy = problemCopy(problem, requested, accountRoleLabel(result.role));

  const retry = async () => {
    setBusy(true);
    try {
      onResolved(await declareSignupRoleIfNeeded({ ...result, roleProblem: undefined }, result.requestedRole));
    } finally {
      setBusy(false);
    }
  };

  const switchAccount = async () => {
    setBusy(true);
    try { await onSwitchAccount(); } finally { setBusy(false); }
  };

  return (
    <section aria-labelledby="role-problem-title" className="space-y-5 text-center">
      <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-600">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <h1 id="role-problem-title" ref={headingRef} tabIndex={-1} className="text-xl font-bold text-gray-900 outline-none">{copy.title}</h1>
        <p role="alert" className="mt-2 text-base text-gray-600">{copy.body}</p>
      </div>
      <div className="flex flex-col gap-2.5">
        {problem === 'failed' ? (
          <>
            <button type="button" onClick={() => void retry()} disabled={busy} className={PRIMARY}>
              {busy && <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />} Reintentar
            </button>
            <button type="button" onClick={() => void switchAccount()} disabled={busy} className={SECONDARY}>Cerrar sesión</button>
          </>
        ) : (
          <>
            <button type="button" onClick={() => void switchAccount()} disabled={busy} className={PRIMARY}>Usar otro correo</button>
            <button type="button" onClick={onContinue} disabled={busy} className={SECONDARY}>
              {problem === 'has_activity' ? 'Seguir como cliente' : 'Entrar en mi cuenta'}
            </button>
          </>
        )}
      </div>
    </section>
  );
};
