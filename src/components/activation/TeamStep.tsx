import React from 'react';
import { Plus, X } from 'lucide-react';
import { LIABILITY_DECLARATION } from '../empresa/InviteMemberCard';

// Paso 4 del cuestionario: «¿Cuentas con más personas en tu equipo?» (2026-11-11). Varios correos a la
// vez; la invitación es la de siempre (correo + enlace). Un autónomo declara su seguro al invitar, y se le
// dice con claridad que su cuenta pasará a ser de equipo cuando acepte la primera persona.

export interface TeamAnswer {
  answer: 'no' | 'yes' | null;
  emails: string[];
  declared: boolean;
}

interface Props {
  value: TeamAnswer;
  onChange: (value: TeamAnswer) => void;
  isTeam: boolean;
  needsLiability: boolean;
  /** Correos con algo que decir (no válido, repetido, falló al invitar). */
  emailErrors: Record<number, string>;
  /** Invitaciones ya enviadas en este cuestionario. */
  sent: Array<{ email: string; emailed: boolean; url: string }>;
}

const option = (selected: boolean) =>
  `flex min-h-16 w-full flex-col justify-center rounded-2xl border-2 px-4 py-3 text-left [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
    selected ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
  }`;

const TeamStep: React.FC<Props> = ({ value, onChange, isTeam, needsLiability, emailErrors, sent }) => {
  const setEmails = (emails: string[]) => onChange({ ...value, emails });
  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-gray-900">¿Cuentas con más personas en tu equipo?</h1>
      <p className="mt-2 text-gray-700">Añádelas a tu perfil y gestiona desde GarSer quién hace cada trabajo.</p>

      <div className="mt-5 space-y-2" role="radiogroup" aria-label="¿Tienes equipo?">
        <button type="button" role="radio" aria-checked={value.answer === 'no'} onClick={() => onChange({ ...value, answer: 'no' })} className={option(value.answer === 'no')}>
          <span className="text-lg font-bold text-gray-900">{isTeam ? 'Ahora no invito a nadie más' : 'No, trabajo solo'}</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value.answer === 'yes'}
          onClick={() => onChange({ ...value, answer: 'yes', emails: value.emails.length > 0 ? value.emails : [''] })}
          className={option(value.answer === 'yes')}
        >
          <span className="text-lg font-bold text-gray-900">Sí, quiero invitarles</span>
          <span className="text-sm text-gray-600">Les llega un correo para unirse a tu equipo.</span>
        </button>
      </div>

      {value.answer === 'yes' && (
        <div className="mt-5">
          <p className="font-semibold text-gray-900">Correo de cada persona</p>
          <ul className="mt-2 space-y-2">
            {value.emails.map((email, index) => (
              <li key={index}>
                <div className="flex items-center gap-2">
                  <label htmlFor={`team-email-${index}`} className="sr-only">{`Correo de la persona ${index + 1}`}</label>
                  <input
                    id={`team-email-${index}`}
                    type="email"
                    inputMode="email"
                    autoComplete="off"
                    placeholder="correo@ejemplo.com"
                    value={email}
                    onChange={(e) => setEmails(value.emails.map((v, i) => (i === index ? e.target.value : v)))}
                    aria-invalid={Boolean(emailErrors[index])}
                    className="min-h-12 min-w-0 flex-1 rounded-xl border border-gray-300 px-3 text-base text-gray-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  {value.emails.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setEmails(value.emails.filter((_, i) => i !== index))}
                      aria-label={`Quitar el correo ${index + 1}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {emailErrors[index] && <p role="alert" className="mt-1 text-sm text-red-700">{emailErrors[index]}</p>}
              </li>
            ))}
          </ul>
          {value.emails.length < 20 && (
            <button
              type="button"
              onClick={() => setEmails([...value.emails, ''])}
              className="mt-2 inline-flex min-h-11 items-center gap-1 rounded text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Añadir otro correo
            </button>
          )}

          {needsLiability && (
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm leading-snug text-gray-800">
              <input
                type="checkbox"
                checked={value.declared}
                onChange={(e) => onChange({ ...value, declared: e.target.checked })}
                className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
              />
              <span>{LIABILITY_DECLARATION}</span>
            </label>
          )}
          {!isTeam && (
            <p className="mt-3 rounded-xl bg-sky-50 px-3 py-2.5 text-sm text-sky-900">
              Cuando acepte la primera persona, tu cuenta pasará a ser de equipo: verás quién hace cada trabajo y el horario de cada uno.
              Tus servicios, precios, enlace y reseñas no cambian.
            </p>
          )}
        </div>
      )}

      {sent.length > 0 && (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p className="font-semibold">Invitaciones enviadas</p>
          <ul className="mt-1 list-disc pl-5">
            {sent.map((s) => (
              <li key={s.email}>
                {s.email}
                {!s.emailed && (
                  <span className="mt-1 block text-amber-900">
                    El correo no salió. Mándale este enlace:{' '}
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard?.writeText(s.url).catch(() => undefined)}
                      className="font-semibold underline underline-offset-2"
                    >
                      copiar enlace
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default TeamStep;
