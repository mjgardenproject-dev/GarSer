import React from 'react';
import { PRIVACY_PATH, TERMS_PATH } from '../../config/legal';

// Piezas comunes de los accesos (2026-10-21): la separación entre Google y el correo, y la nota
// legal. Los enlaces abren otra pestaña para no perder lo que hay en pantalla (una reserva a medias).

export const OrWithEmail: React.FC<{ label?: string }> = ({ label = 'o con tu correo' }) => (
  <div className="flex items-center gap-3" role="separator" aria-label={label}>
    <span className="h-px flex-1 bg-gray-200" />
    <span className="text-sm text-gray-500">{label}</span>
    <span className="h-px flex-1 bg-gray-200" />
  </div>
);

export const LegalConsentNote: React.FC<{ className?: string }> = ({ className = '' }) => (
  <p className={`text-xs leading-5 text-gray-500 ${className}`}>
    Al continuar, aceptas los{' '}
    <a href={TERMS_PATH} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-700 underline hover:text-gray-900">Términos y condiciones</a>
    {' '}y la{' '}
    <a href={PRIVACY_PATH} target="_blank" rel="noopener noreferrer" className="font-medium text-gray-700 underline hover:text-gray-900">Política de privacidad</a>
    {' '}de GarSer.
  </p>
);
