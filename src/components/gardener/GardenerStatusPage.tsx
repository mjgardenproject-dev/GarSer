import React from 'react';
import { Clock, AlertTriangle, LogOut } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

import { restartRejectedApplication } from '../../utils/gardenerApplicationRetry';

interface GardenerStatusPageProps {
  status: 'pending' | 'denied';
  denialReason?: string;
}

const GardenerStatusPage: React.FC<GardenerStatusPageProps> = ({ status, denialReason }) => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [isResetting, setIsResetting] = React.useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate('/auth');
  };

  // PH-02: reabrir la solicitud lo hace el servidor (antes el navegador intentaba un UPDATE y un
  // DELETE que las reglas no dejan: respondía bien, no hacía nada y el jardinero quedaba bloqueado).
  const [retryError, setRetryError] = React.useState('');
  const handleRetry = async () => {
    if (!user) return;
    setIsResetting(true);
    setRetryError('');
    try {
      await restartRejectedApplication();
      // Se rellena con lo que ya tenía en la base de datos, no con un borrador local viejo.
      try {
        localStorage.removeItem(`gardener_wizard_progress_${user.id}`);
        localStorage.removeItem('gardenerApplicationStatus');
        localStorage.removeItem('gardenerApplicationJustSubmitted');
      } catch (e) {
        console.error('Error clearing local storage:', e);
      }
      window.location.assign('/apply');
    } catch (error) {
      console.error('Error resetting application:', error);
      setRetryError(error instanceof Error ? error.message : 'No se ha podido reabrir tu solicitud. Inténtalo de nuevo.');
      setIsResetting(false);
    }
  };

  if (status === 'pending') {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <Clock className="w-10 h-10 text-yellow-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Solicitud en revisión</h1>
          <p className="text-gray-600 mb-8">
            Tu solicitud para unirte a GarSer como jardinero ha sido recibida correctamente. 
            Nuestro equipo está revisando tu perfil y documentación.
          </p>
          <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm mb-8">
            Te notificaremos por email cuando tu cuenta sea activada.
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </div>
    );
  }

  if (status === 'denied') {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-10 h-10 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Solicitud no aceptada</h1>
          <p className="text-gray-600 mb-6">
            Gracias por tu interés en GarSer. Tras revisar tu solicitud, hemos decidido no continuar con el proceso en este momento.
          </p>
          
          {denialReason && (
            <div className="bg-red-50 text-red-800 p-4 rounded-xl text-left mb-8">
              <p className="font-semibold text-sm mb-1">Motivo:</p>
              <p className="text-sm">{denialReason}</p>
            </div>
          )}
          
          <div className="space-y-3">
            <button
              onClick={handleRetry}
              disabled={isResetting}
              aria-busy={isResetting}
              className="w-full min-h-11 px-4 py-2 bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isResetting ? 'Abriendo tu solicitud…' : 'Corregir y volver a enviar'}
            </button>
            {retryError && <p role="alert" className="text-sm text-red-700">{retryError}</p>}
            <button
              onClick={handleSignOut}
              className="flex items-center justify-center gap-2 w-full px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Cerrar sesión</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default GardenerStatusPage;
