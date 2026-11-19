import React from 'react';
import { Mail, CheckCircle, X } from 'lucide-react';

interface EmailConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string;
  /** Pide otro correo de confirmación (QA-039). */
  onResend?: () => void;
  /** Segundos que faltan para poder pedirlo otra vez. */
  resendWait?: number;
}

const EmailConfirmationModal: React.FC<EmailConfirmationModalProps> = ({
  isOpen,
  onClose,
  email,
  onResend,
  resendWait = 0,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black bg-opacity-50 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" aria-label="Registro completado" className="relative my-auto max-h-full w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl animate-in fade-in duration-300 sm:p-8">
        {/* Botón de cerrar: 44 pt y dentro de la ventana (antes quedaba cortado en el móvil). */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <X className="w-6 h-6" aria-hidden="true" />
        </button>

        {/* Icono principal */}
        <div className="text-center mb-6">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail className="w-10 h-10 text-green-600" />
          </div>
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto -mt-12 mb-4 border-4 border-white">
            <CheckCircle className="w-8 h-8 text-white" />
          </div>
        </div>

        {/* Contenido */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            ¡Registro Exitoso!
          </h2>
          <p className="text-gray-600 mb-4">
            Hemos enviado un email de confirmación a:
          </p>
          <div className="bg-gray-50 rounded-lg p-3 mb-6">
            <p className="font-semibold text-green-600 break-all">
              {email}
            </p>
          </div>
          <div className="space-y-3 text-sm text-gray-600 mb-6">
            <div className="flex items-start space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
              <p>Revisa tu bandeja de entrada y la carpeta de spam</p>
            </div>
            <div className="flex items-start space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
              <p>Haz clic en el enlace de confirmación para activar tu cuenta</p>
            </div>
            <div className="flex items-start space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full mt-2 flex-shrink-0"></div>
              <p>Una vez confirmado, podrás iniciar sesión normalmente</p>
            </div>
          </div>
        </div>

        {/* Botones */}
        <div className="space-y-3">
          <button
            onClick={onClose}
            className="w-full bg-emerald-700 text-white py-3 px-4 rounded-lg font-semibold hover:bg-emerald-800 transition-colors"
          >
            Entendido
          </button>
          {onResend ? (
            <button
              type="button"
              onClick={onResend}
              disabled={resendWait > 0}
              className="w-full rounded-lg border border-gray-300 bg-white px-4 py-3 font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {resendWait > 0 ? `Reenviar en ${resendWait} s` : 'Reenviar el correo'}
            </button>
          ) : null}
          <button
            onClick={() => window.open(`https://${email.split('@')[1]}`, '_blank')}
            className="w-full bg-gray-100 text-gray-700 py-3 px-4 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
          >
            Abrir mi correo
          </button>
        </div>

        {/* Nota adicional */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <p className="text-xs text-blue-700 text-center">
            <strong>Nota:</strong> Si no recibes el email en unos minutos, revisa tu carpeta de spam o
            pulsa «Reenviar el correo».
          </p>
        </div>
      </div>
    </div>
  );
};

export default EmailConfirmationModal;