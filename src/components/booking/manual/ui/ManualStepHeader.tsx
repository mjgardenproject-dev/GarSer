import React from 'react';

interface Props {
  /** Línea de contexto: «Poda de setos · Pregunta 1 de 4». */
  eyebrow?: string;
  title: string;
  description?: string;
  /** Recibe el foco al cambiar de pantalla, para que el lector de pantalla anuncie la pregunta. */
  headingRef?: React.Ref<HTMLHeadingElement>;
}

/**
 * Cabecera de cada pantalla del asistente manual (SISTEMA-UX §6.1-6.2): contexto en una línea,
 * la pregunta como título y, como mucho, una frase de apoyo. Es lo único que se lee antes del
 * control, así que no lleva nada más.
 */
export const ManualStepHeader: React.FC<Props> = ({ eyebrow, title, description, headingRef }) => (
  <div className="mb-6">
    {eyebrow ? <p className="text-sm font-semibold text-emerald-800">{eyebrow}</p> : null}
    <h2
      ref={headingRef}
      tabIndex={-1}
      data-manual-heading
      className="mt-1 text-xl leading-7 font-semibold text-gray-900 outline-none"
    >
      {title}
    </h2>
    {description ? <p className="mt-1 text-[15px] leading-6 text-gray-600">{description}</p> : null}
  </div>
);
