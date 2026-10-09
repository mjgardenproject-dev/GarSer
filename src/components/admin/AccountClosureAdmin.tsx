import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Loader2, Search, ShieldOff, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useConfirmDialog } from '../common/ConfirmDialog';

// Prueba real · F6 (R-02, D23): la única vía para quitar una cuenta sin romper nada. Antes solo
// existía el panel de Supabase, que borra en bruto (con empresas se bloqueaba; con clientes o
// autónomos se llevaba sus reservas pagadas). El servidor decide qué se puede hacer:
//   · «Borrar»: no tiene ninguna reserva; se borra entera.
//   · «Dar de baja»: tiene historial; datos personales fuera, sin acceso, reservas e importes intactos.
//   · Bloqueada: reservas sin terminar, pagos, incidencias o planes activos; primero hay que cerrarlos.
// «Suspender» (solo proveedores) corta las reservas nuevas sin tocar las ya citadas.

export type ClosurePlan = {
  exists: boolean;
  userId?: string;
  email?: string;
  role?: string | null;
  company?: { id: string; status: string; name: string | null; activeEmployees: number } | null;
  employeeOf?: string | null;
  suspended?: boolean | null;
  hasHistory?: boolean;
  blockers?: Array<{ code: string; message: string; count?: number }>;
  mode?: 'delete' | 'deactivate' | 'blocked';
};

const ROLE_LABEL: Record<string, string> = {
  client: 'Cliente', gardener: 'Profesional autónomo', company: 'Empresa', employee: 'Empleado de empresa', admin: 'Administración',
};

const AccountClosureAdmin: React.FC = () => {
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<ClosurePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState(false);
  const { openConfirm, confirmDialog } = useConfirmDialog();

  const review = async (target = email) => {
    if (!target.trim()) return;
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_account_closure_preview', { p_email: target.trim() });
    setLoading(false);
    if (error) {
      toast.error(error.message || 'No se ha podido revisar la cuenta.');
      return;
    }
    setPlan(data as ClosurePlan);
  };

  const close = () => {
    if (!plan?.userId || (plan.mode !== 'delete' && plan.mode !== 'deactivate')) return;
    const deleting = plan.mode === 'delete';
    openConfirm({
      title: deleting ? `¿Borrar la cuenta ${plan.email}?` : `¿Dar de baja ${plan.email}?`,
      message: deleting
        ? 'No tiene ninguna reserva: se borrará entera (perfil, ficha, empresa, horarios y solicitudes). No se puede deshacer.'
        : 'Tiene historial: se borran sus datos personales, no podrá volver a entrar y deja de aparecer. Sus reservas, importes y reseñas se conservan. No se puede deshacer.',
      confirmLabel: deleting ? 'Borrar cuenta' : 'Dar de baja',
      tone: 'danger',
      onConfirm: async () => {
        setActing(true);
        const { data, error } = await supabase.functions.invoke('admin-account-closure', {
          body: { userId: plan.userId, expectedMode: plan.mode },
        });
        setActing(false);
        // functions.invoke no lanza en errores HTTP: el motivo viene en el cuerpo.
        const message = (data as { error?: string } | null)?.error
          || (error ? await (error as { context?: Response }).context?.json?.().then((b: { error?: string }) => b?.error).catch(() => null) : null);
        if (error || message) {
          toast.error(message || 'No se ha podido completar la baja.');
          await review(plan.email || email);
          return;
        }
        toast.success(deleting ? 'Cuenta borrada' : 'Cuenta dada de baja');
        setPlan(null);
        setEmail('');
      },
    });
  };

  const toggleSuspended = async () => {
    if (!plan?.userId) return;
    setActing(true);
    const { error } = await supabase.rpc('admin_set_provider_suspended', { p_user_id: plan.userId, p_suspended: !plan.suspended });
    setActing(false);
    if (error) {
      toast.error(error.message || 'No se ha podido cambiar.');
      return;
    }
    // PR-02: el profesional lo ve en su panel y recibe un correo (lo apunta el servidor).
    toast.success(plan.suspended ? 'Vuelve a recibir reservas. Le avisamos por correo.' : 'Suspendida: no recibirá reservas nuevas. Le avisamos por correo y lo verá en su panel.');
    await review(plan.email || email);
  };

  const isProvider = plan?.role === 'gardener' || plan?.role === 'company';

  return (
    <div className="p-4 sm:p-6">
      <p className="mb-3 text-sm text-gray-600">
        Busca una cuenta por su correo. GarSer te dice qué se puede hacer con ella antes de tocar nada.
      </p>
      <form
        onSubmit={(e) => { e.preventDefault(); void review(); }}
        className="flex gap-2"
      >
        <label htmlFor="closure-email" className="sr-only">Correo de la cuenta</label>
        <input
          id="closure-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="correo@ejemplo.com"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-base sm:text-sm"
        />
        <button type="submit" disabled={loading || !email.trim()} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Revisar
        </button>
      </form>

      {plan && !plan.exists && (
        <p className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">No hay ninguna cuenta con ese correo.</p>
      )}

      {plan?.exists && (
        <section className="mt-4 rounded-xl border border-gray-200 p-4" aria-live="polite">
          <p className="break-all font-semibold text-gray-900">{plan.email}</p>
          <p className="text-sm text-gray-600">
            {ROLE_LABEL[plan.role || ''] || 'Sin tipo de cuenta'}
            {plan.company?.name ? ` · ${plan.company.name}` : ''}
            {plan.company ? ` · ${plan.company.activeEmployees} empleado(s) activo(s)` : ''}
            {plan.employeeOf ? ` · trabaja en ${plan.employeeOf}` : ''}
            {plan.suspended ? ' · SUSPENDIDA' : ''}
          </p>

          {plan.mode === 'blocked' && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="h-4 w-4" /> Aún no se puede dar de baja</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {(plan.blockers || []).map((b) => <li key={b.code}>{b.message}</li>)}
              </ul>
            </div>
          )}
          {plan.mode === 'delete' && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              No tiene ninguna reserva: se puede <span className="font-semibold">borrar entera</span>.
            </p>
          )}
          {plan.mode === 'deactivate' && (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Tiene reservas pasadas: se <span className="font-semibold">da de baja</span> conservando reservas, importes y reseñas (sin sus datos personales).
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {isProvider && (
              <button type="button" onClick={() => void toggleSuspended()} disabled={acting}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-800 disabled:opacity-50">
                {plan.suspended ? <ShieldCheck className="h-4 w-4" /> : <ShieldOff className="h-4 w-4" />}
                {plan.suspended ? 'Reactivar' : 'Suspender'}
              </button>
            )}
            {(plan.mode === 'delete' || plan.mode === 'deactivate') && (
              <button type="button" onClick={close} disabled={acting}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                {plan.mode === 'delete' ? <Trash2 className="h-4 w-4" /> : <UserX className="h-4 w-4" />}
                {plan.mode === 'delete' ? 'Borrar cuenta' : 'Dar de baja'}
              </button>
            )}
          </div>
        </section>
      )}
      {confirmDialog}
    </div>
  );
};

export default AccountClosureAdmin;
