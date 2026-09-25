import React from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Loader2, LogOut, PencilLine } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useCompanyOnboarding } from '../../hooks/useCompanyOnboarding';

// Estado de la solicitud de alta de una empresa (GarSer Empresas F3.2): en revisión o no
// aceptada. Al rechazo se puede corregir y volver a enviar: se abre un borrador nuevo con los
// datos de la anterior (la rechazada se conserva como histórico).

const CompanyStatusPage: React.FC = () => {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const { loading, stage, application } = useCompanyOnboarding();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
      </div>
    );
  }
  if (stage === 'not_company') return <Navigate to="/dashboard" replace />;
  if (stage === 'approved') return <Navigate to="/empresa" replace />;
  if (stage === 'none' || stage === 'draft') return <Navigate to="/empresa/solicitud" replace />;

  const rejected = stage === 'rejected';

  return (
    <div className="flex min-h-screen items-start justify-center bg-gray-50 px-4 py-10 sm:items-center">
      <div className="w-full rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm sm:max-w-md">
        <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full ${rejected ? 'bg-red-100' : 'bg-amber-100'}`}>
          {rejected ? <AlertTriangle className="h-7 w-7 text-red-600" /> : <Clock className="h-7 w-7 text-amber-600" />}
        </div>
        <h1 className="text-xl font-bold text-gray-900">{rejected ? 'Solicitud no aceptada' : 'Solicitud en revisión'}</h1>
        <p className="mt-2 text-sm text-gray-600">
          {rejected
            ? 'Hemos revisado la solicitud de tu empresa y ahora mismo no podemos darla de alta.'
            : 'Hemos recibido la solicitud de tu empresa. La revisamos y te avisaremos por correo en cuanto esté lista.'}
        </p>

        {rejected && application?.review_comment && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-4 text-left">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Motivo</p>
            <p className="mt-1 text-sm text-gray-800">{application.review_comment}</p>
          </div>
        )}

        <div className="mt-6 space-y-3">
          {rejected && (
            <button
              type="button"
              onClick={() => navigate('/empresa/solicitud', { state: { retry: true } })}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white shadow-lg shadow-emerald-700/20 transition-all hover:bg-emerald-800 active:scale-[0.98]"
            >
              <PencilLine className="h-5 w-5" /> Corregir y enviar de nuevo
            </button>
          )}
          <button
            type="button"
            onClick={async () => { await signOut(); navigate('/auth'); }}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold text-gray-700 hover:bg-gray-50"
          >
            <LogOut className="h-5 w-5" /> Cerrar sesión
          </button>
        </div>
      </div>
    </div>
  );
};

export default CompanyStatusPage;
