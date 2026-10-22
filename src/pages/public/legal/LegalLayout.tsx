import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import GarserLogo from '../../../components/common/GarserLogo';
import PublicFooter from '../../../components/public/PublicFooter';
import { LEGAL_INFO } from '../../../config/legal';

// Páginas legales (2026-10-21): cabecera mínima, texto legible en el móvil y el pie público.

/** Un dato del titular: el valor, o «[Completar: …]» resaltado si aún está vacío (src/config/legal.ts). */
export const Fill: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  value.trim()
    ? <>{value}</>
    : <mark className="rounded bg-amber-100 px-1 font-semibold text-amber-900">[Completar: {label}]</mark>
);

export const Section: React.FC<{ id?: string; title: string; children: React.ReactNode }> = ({ id, title, children }) => (
  <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="scroll-mt-6">
    <h2 id={id ? `${id}-title` : undefined} className="mt-10 text-xl font-bold text-gray-900">{title}</h2>
    <div className="mt-3 space-y-3 text-base leading-7 text-gray-700">{children}</div>
  </section>
);

const LegalLayout: React.FC<{ title: string; intro: string; children: React.ReactNode }> = ({ title, intro, children }) => (
  <div className="min-h-screen bg-white">
    <header className="border-b border-gray-100">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
        <Link to="/" aria-label="GarSer, ir al inicio" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
          <GarserLogo className="h-8 w-auto" textClassName="text-xl font-bold text-gray-900" />
        </Link>
        <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-semibold text-emerald-700 hover:text-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al inicio
        </Link>
      </div>
    </header>
    <main className="mx-auto max-w-3xl px-4 pb-16 pt-8">
      <h1 className="text-3xl font-bold tracking-tight text-gray-900">{title}</h1>
      <p className="mt-2 text-sm text-gray-500">Última actualización: {LEGAL_INFO.updatedAt}</p>
      <p className="mt-6 text-base leading-7 text-gray-700">{intro}</p>
      {children}
    </main>
    <PublicFooter />
  </div>
);

export default LegalLayout;
