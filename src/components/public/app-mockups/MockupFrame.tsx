import React from 'react';

type MockupFrameProps = {
  /** Texto alternativo: lo que un lector de pantalla anuncia en lugar del dibujo. */
  label: string;
  /** Título de la pantalla de la app que se imita (barra superior). */
  screenTitle: string;
  children: React.ReactNode;
};

/**
 * Marco de las «capturas» de la app que usa /para-jardineros. Son decorativas: se anuncian
 * como una sola imagen (`role="img"` + `aria-label`), el contenido interior va oculto a la
 * accesibilidad y no reciben clics ni foco, para que nadie intente pulsar sus botones de mentira.
 * El bisel gris y la barra de título hacen que se lean como pantalla, no como parte de la web.
 */
const MockupFrame: React.FC<MockupFrameProps> = ({ label, screenTitle, children }) => (
  <div
    role="img"
    aria-label={label}
    className="pointer-events-none select-none rounded-[1.75rem] bg-slate-100 p-1.5 shadow-sm ring-1 ring-slate-900/5"
  >
    <div aria-hidden="true" className="overflow-hidden rounded-[1.4rem] bg-gray-50 text-left">
      <div className="border-b border-gray-200 bg-white px-4 py-2.5">
        <p className="text-sm font-bold text-gray-900">{screenTitle}</p>
      </div>
      <div className="p-3">{children}</div>
    </div>
  </div>
);

export default MockupFrame;
