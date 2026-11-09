import React, { useState } from 'react';
import { Check, Copy, Loader2, Mail, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

// Invitar a una persona al equipo (GarSer Empresas F3.3, A-22). El servidor genera el token y
// solo guarda su huella; aquí se recibe UNA vez: para pedir el correo de invitación (F3.4, que
// comprueba el token contra esa huella) y para poder copiar el enlace si el correo no llega.

interface Props {
  onInvited: () => void;
  /**
   * Pide confirmar el seguro de responsabilidad civil antes de invitar: la PRIMERA invitación de un
   * profesional que aún no tiene equipo (D35, 2026-11-08). El servidor la exige y la guarda con fecha.
   */
  requireLiability?: boolean;
  /** Sin la tarjeta alrededor ni título: lo pone quien lo usa (la hoja «Añade a tu equipo»). */
  bare?: boolean;
  /** Lo que se dice tras enviar (p. ej. que su cuenta no cambia hasta que acepte). */
  sentNote?: string;
}

export const LIABILITY_DECLARATION =
  'Mi actividad cuenta con un seguro de responsabilidad civil que cubre también a las personas de mi equipo.';

const InviteMemberCard: React.FC<Props> = ({ onInvited, requireLiability = false, bare = false, sentNote }) => {
  const [email, setEmail] = useState('');
  const [declared, setDeclared] = useState(false);
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (requireLiability && !declared) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc(
        'create_company_invitation',
        requireLiability ? { p_email: email, p_liability_declared: true } : { p_email: email },
      );
      if (error) throw error;
      const result = data as { invitation_id: string; token: string; email: string };
      // El único correo que sigue saliendo del navegador (prueba real F3): lleva el código de la
      // invitación en claro, que la base de datos solo guarda cifrado. Un reintento si falla la
      // red; si aun así no sale, el dueño tiene el enlace para copiarlo aquí mismo.
      let mailError: unknown = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        ({ error: mailError } = await supabase.functions.invoke('send-email-notification', {
          body: { type: 'company_invitation', invitationId: result.invitation_id, token: result.token },
        }));
        if (!mailError) break;
      }
      setLink({ url: `${window.location.origin}/invitacion?token=${result.token}`, email: result.email, emailed: !mailError });
      setCopied(false);
      setEmail('');
      onInvited();
    } catch (err: unknown) {
      toast.error((err as { message?: string })?.message || 'No se ha podido crear la invitación.');
    } finally {
      setSending(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se ha podido copiar. Mantén pulsado el enlace para copiarlo.');
    }
  };

  const form = (
    <form onSubmit={invite} className={bare ? 'space-y-3' : 'mt-3 space-y-3'}>
      {requireLiability && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm leading-snug text-gray-800">
          <input
            type="checkbox"
            checked={declared}
            onChange={(e) => setDeclared(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-emerald-700 focus:ring-emerald-600"
          />
          <span>{LIABILITY_DECLARATION}</span>
        </label>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="invite-email" className="sr-only">Correo de la persona</label>
        <div className="relative flex-1">
          <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo@ejemplo.com"
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-base focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20"
          />
        </div>
        <button
          type="submit"
          disabled={sending || email.trim().length === 0 || (requireLiability && !declared)}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 [touch-action:manipulation]"
        >
          {sending && <Loader2 className="h-5 w-5 animate-spin" />} {bare ? 'Enviar invitación' : 'Invitar'}
        </button>
      </div>
    </form>
  );

  const sent = link && (
    <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-sm font-medium text-emerald-900">
        {link.emailed ? `Le hemos enviado la invitación a ${link.email}` : `Invitación creada para ${link.email}`}
      </p>
      <p className="mt-0.5 text-xs text-emerald-800">
        {link.emailed
          ? 'También puedes mandarle este enlace por WhatsApp. Caduca en 7 días y solo sirve con ese correo.'
          : 'No hemos podido enviar el correo: mándale tú este enlace. Caduca en 7 días y solo sirve con ese correo.'}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 truncate rounded-lg border border-emerald-200 bg-white px-3 py-2 text-base text-gray-700" aria-label="Enlace de invitación" />
        <button type="button" onClick={copy} className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 [touch-action:manipulation]">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      {sentNote && <p className="mt-2 text-xs font-semibold text-emerald-900">{sentNote}</p>}
    </div>
  );

  if (bare) {
    return (
      <div>
        {form}
        {sent}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
        <UserPlus className="h-5 w-5 text-emerald-700" /> Invitar a alguien a tu equipo
      </h2>
      <p className="mt-1 text-sm text-gray-600">Le llegará una invitación para crear su cuenta de empleado con ese correo.</p>
      {form}
      {sent}
    </section>
  );
};

export default InviteMemberCard;
