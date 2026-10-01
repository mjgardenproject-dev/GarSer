import React from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  id: string;
  message?: string | null;
}

/**
 * Error de un campo, justo debajo del control (SISTEMA-UX §6.10). El campo lo enlaza con
 * `aria-describedby` y lleva `aria-invalid`; el asistente le pasa el foco al fallar, así que el
 * lector de pantalla lo lee sin necesidad de `role="alert"`.
 */
export const FieldError: React.FC<Props> = ({ id, message }) =>
  message ? (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-sm font-medium text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  ) : null;
