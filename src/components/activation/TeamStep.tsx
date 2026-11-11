import React from 'react';
import { Plus, X } from 'lucide-react';
import { LIABILITY_DECLARATION } from '../empresa/InviteMemberCard';
import { emptyPersonPreset, type PersonPreset } from '../../utils/teamInvitations';

// Paso 4 del cuestionario: «¿Cuentas con más personas en tu equipo?» (2026-11-11). Varios correos a la
// vez; la invitación es la de siempre (correo + enlace). Un autónomo declara su seguro al invitar, y se le
// dice con claridad que su cuenta pasará a ser de equipo cuando acepte la primera persona.

export interface TeamAnswer {
  answer: 'no' | 'yes' | null;
  emails: string[];
  /** Lo que el titular elige para cada persona (mismo orden que `emails`); null = sin configurar. */
  presets: Array<PersonPreset | null>;
  declared: boolean;
}

const DAYS = [
  { value: 1, label: 'L' }, { value: 2, label: 'M' }, { value: 3, label: 'X' }, { value: 4, label: 'J' },
  { value: 5, label: 'V' }, { value: 6, label: 'S' }, { value: 0, label: 'D' },
];
const HOURS = Array.from({ length: 14 }, (_, i) => 7 + i); // 7..20

const PersonPresetEditor: React.FC<{
  preset: PersonPreset;
  onChange: (preset: PersonPreset) => void;
  serviceOptions: Array<{ id: string; name: string }>;
  offersPhyto: boolean;
  index: number;
}> = ({ preset, onChange, serviceOptions, offersPhyto, index }) => (
  <div className="mt-2 space-y-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
    <div>
      <label htmlFor={`preset-name-${index}`} className="block text-sm font-semibold text-gray-900">¿Cómo se llama?</label>
      <input
        id={`preset-name-${index}`}
        value={preset.name}
        onChange={(e) => onChange({ ...preset, name: e.target.value })}
        maxLength={80}
        placeholder="Para reconocerle en tu equipo"
        className="mt-1 min-h-11 w-full rounded-xl border border-gray-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
      />
    </div>
    {serviceOptions.length > 0 && (
      <fieldset>
        <legend className="text-sm font-semibold text-gray-900">¿Qué servicios hará?</legend>
        <div className="mt-1 space-y-1">
          {serviceOptions.map((service) => {
            const checked = preset.serviceIds.includes(service.id);
            return (
              <label key={service.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-gray-800">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({ ...preset, serviceIds: checked ? preset.serviceIds.filter((id) => id !== service.id) : [...preset.serviceIds, service.id] })
                  }
                  className="h-5 w-5 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
                />
                {service.name}
              </label>
            );
          })}
        </div>
      </fieldset>
    )}
    <fieldset>
      <legend className="text-sm font-semibold text-gray-900">¿Qué horario tendrá?</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {([['company', 'El mismo que el mío'], ['custom', 'Otro']] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={preset.schedule === value}
            onClick={() => onChange({ ...preset, schedule: value })}
            className={`min-h-11 rounded-full border px-4 text-sm font-semibold [touch-action:manipulation] ${
              preset.schedule === value ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {preset.schedule === 'custom' && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Días que trabaja">
            {DAYS.map((day) => {
              const on = preset.days.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...preset, days: on ? preset.days.filter((d) => d !== day.value) : [...preset.days, day.value] })}
                  className={`h-11 w-11 rounded-full border text-sm font-bold [touch-action:manipulation] ${on ? 'border-emerald-700 bg-emerald-700 text-white' : 'border-gray-300 bg-white text-gray-700'}`}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`preset-start-${index}`}>Desde</label>
            <select id={`preset-start-${index}`} value={preset.start} onChange={(e) => onChange({ ...preset, start: Number(e.target.value) })} className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-base">
              {HOURS.slice(0, -1).map((h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
            <span aria-hidden="true">–</span>
            <label className="sr-only" htmlFor={`preset-end-${index}`}>Hasta</label>
            <select id={`preset-end-${index}`} value={preset.end} onChange={(e) => onChange({ ...preset, end: Number(e.target.value) })} className="min-h-11 rounded-xl border border-gray-300 bg-white px-3 text-base">
              {HOURS.slice(1).map((h) => <option key={h} value={h}>{h}:00</option>)}
            </select>
          </div>
        </div>
      )}
    </fieldset>
    {offersPhyto && (
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={preset.requestLicense}
          onChange={(e) => onChange({ ...preset, requestLicense: e.target.checked })}
          className="mt-0.5 h-5 w-5 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
        />
        <span>Hará tratamientos fitosanitarios: pídele su carnet de aplicador al entrar.</span>
      </label>
    )}
  </div>
);

interface Props {
  value: TeamAnswer;
  onChange: (value: TeamAnswer) => void;
  isTeam: boolean;
  needsLiability: boolean;
  /** Correos con algo que decir (no válido, repetido, falló al invitar). */
  emailErrors: Record<number, string>;
  /** Invitaciones ya enviadas en este cuestionario. */
  sent: Array<{ email: string; emailed: boolean; url: string }>;
  /** Servicios de la empresa que se le pueden asignar (configurados; fitosanitarios no: pide su carnet). */
  serviceOptions: Array<{ id: string; name: string }>;
  offersPhyto: boolean;
}

const option = (selected: boolean) =>
  `flex min-h-16 w-full flex-col justify-center rounded-2xl border-2 px-4 py-3 text-left [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
    selected ? 'border-emerald-700 bg-emerald-50' : 'border-gray-200 bg-white hover:bg-gray-50'
  }`;

const TeamStep: React.FC<Props> = ({ value, onChange, isTeam, needsLiability, emailErrors, sent, serviceOptions, offersPhyto }) => {
  const presetAt = (index: number) => value.presets[index] ?? null;
  const setPreset = (index: number, preset: PersonPreset | null) =>
    onChange({ ...value, presets: value.emails.map((_, i) => (i === index ? preset : presetAt(i))) });
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
          onClick={() => onChange({ ...value, answer: 'yes', emails: value.emails.length > 0 ? value.emails : [''], presets: value.emails.length > 0 ? value.presets : [null] })}
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
                    onChange={(e) => onChange({ ...value, emails: value.emails.map((v, i) => (i === index ? e.target.value : v)) })}
                    aria-invalid={Boolean(emailErrors[index])}
                    className="min-h-12 min-w-0 flex-1 rounded-xl border border-gray-300 px-3 text-base text-gray-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                  {value.emails.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...value,
                          emails: value.emails.filter((_, i) => i !== index),
                          presets: value.emails.map((_, i) => presetAt(i)).filter((_, i) => i !== index),
                        })
                      }
                      aria-label={`Quitar el correo ${index + 1}`}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                    >
                      <X className="h-5 w-5" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {emailErrors[index] && <p role="alert" className="mt-1 text-sm text-red-700">{emailErrors[index]}</p>}
                {presetAt(index) ? (
                  <>
                    <PersonPresetEditor
                      preset={presetAt(index)!}
                      onChange={(preset) => setPreset(index, preset)}
                      serviceOptions={serviceOptions}
                      offersPhyto={offersPhyto}
                      index={index}
                    />
                    <button
                      type="button"
                      onClick={() => setPreset(index, null)}
                      className="mt-1 inline-flex min-h-11 items-center rounded text-sm font-semibold text-gray-600 hover:underline"
                    >
                      Quitar su configuración
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPreset(index, emptyPersonPreset())}
                    className="mt-1 inline-flex min-h-11 items-center rounded text-sm font-semibold text-emerald-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation]"
                  >
                    Configurar a esta persona (opcional, 1 minuto)
                  </button>
                )}
              </li>
            ))}
          </ul>
          {value.emails.length < 20 && (
            <button
              type="button"
              onClick={() => onChange({ ...value, emails: [...value.emails, ''], presets: [...value.emails.map((_, i) => presetAt(i)), null] })}
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
