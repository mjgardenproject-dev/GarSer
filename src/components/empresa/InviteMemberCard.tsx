import React, { useState } from 'react';
import { Check, Copy, Loader2, Mail, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';

// Invitar a una persona al equipo (GarSer Empresas F3.3, A-22). El servidor genera el token y
// solo guarda su huella; aquí se recibe UNA vez para poder copiar el enlace. El correo con la
// invitación lo envía F3.4.

interface Props {
  onInvited: () => void;
}

const InviteMemberCard: React.FC<Props> = ({ onInvited }) => {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [link, setLink] = useState<{ url: string; email: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    try {
      const { data, error } = await supabase.rpc('create_company_invitation', { p_email: email });
      if (error) throw error;
      const result = data as { token: string; email: string };
      setLink({ url: `${window.location.origin}/invitacion?token=${result.token}`, email: result.email });
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

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-base font-bold text-gray-900">
        <UserPlus className="h-5 w-5 text-emerald-700" /> Invitar a alguien a tu equipo
      </h2>
      <p className="mt-1 text-sm text-gray-600">Le llegará una invitación para crear su cuenta de empleado con ese correo.</p>

      <form onSubmit={invite} className="mt-3 flex flex-col gap-2 sm:flex-row">
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
          disabled={sending || email.trim().length === 0}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 hover:bg-emerald-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending && <Loader2 className="h-5 w-5 animate-spin" />} Invitar
        </button>
      </form>

      {link && (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-sm font-medium text-emerald-900">Invitación creada para {link.email}</p>
          <p className="mt-0.5 text-xs text-emerald-800">Envíale este enlace. Caduca en 7 días y solo sirve con ese correo.</p>
          <div className="mt-2 flex items-center gap-2">
            <input readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 truncate rounded-lg border border-emerald-200 bg-white px-3 py-2 text-base text-gray-700" aria-label="Enlace de invitación" />
            <button type="button" onClick={copy} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

export default InviteMemberCard;
