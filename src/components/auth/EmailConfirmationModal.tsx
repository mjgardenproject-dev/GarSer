import React from 'react';
import { Mail, CheckCircle, X } from 'lucide-react';

interface EmailConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  email: string;
}

const EmailConfirmationModal: React.FC<EmailConfirmationModalProps> = ({
  isOpen,
  onClose,
  email
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 relative animate-in fade-in duration-300">
        {/* Botón de cerrar */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-6 h-6" />
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
            className="w-full bg-green-600 text-white py-3 px-4 rounded-lg font-semibold hover:bg-green-700 transition-colors"
          >
            Entendido
          </button>
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
            <strong>Nota:</strong> Si no recibes el email en unos minutos, 
            revisa tu carpeta de spam o intenta registrarte nuevamente.
          </p>
        </div>
      </div>
    </div>
  );
};

export default EmailConfirmationModal;