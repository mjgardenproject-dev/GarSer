import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';

import GarserLogo from '../common/GarserLogo';
import { PUBLIC_CONTACT_ANCHOR } from '../../config/publicSiteContent';
import { clearBookingResumeStorage } from '../../utils/bookingResumeStorage';

/** Páginas públicas de la navegación. «Reservar» no está aquí: no es una página, es la acción
 * de empezar una reserva, y por eso nunca se marca como «estás aquí». */
const NAV_PAGES = [
  { to: '/marbella', label: 'Marbella' },
  { to: '/para-jardineros', label: 'Soy jardinero' },
] as const;

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2';

const PublicHeader: React.FC = () => {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const handleReservar = () => {
    clearBookingResumeStorage({ flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-100/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="inline-flex items-center">
            <GarserLogo className="h-8 w-auto" textClassName="text-xl font-bold text-gray-900" />
          </Link>

          <div className="flex items-center gap-2 md:hidden">
            {/* Baja al bloque «Contacto y ayuda» del pie (WhatsApp y correo). */}
            <a
              href={`#${PUBLIC_CONTACT_ANCHOR}`}
              aria-label="Contacto y ayuda"
              className={`inline-flex h-9 min-w-[2.25rem] items-center justify-center gap-1.5 rounded-full border border-slate-200 px-2.5 text-sm font-semibold text-slate-700 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 ${focusRing}`}
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              <span className="hidden min-[390px]:inline">Ayuda</span>
            </a>
            <Link
              to="/auth"
              className={`inline-flex h-9 items-center gap-2 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white transition-transform hover:scale-[1.01] ${focusRing}`}
            >
              Acceder
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <nav aria-label="Principal" className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          <button
            type="button"
            onClick={handleReservar}
            className={`inline-flex items-center gap-2 rounded-full border border-emerald-700 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition-colors hover:bg-emerald-50 ${focusRing}`}
          >
            Reservar
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          {NAV_PAGES.map((page) => {
            const isCurrent = pathname === page.to;
            return (
              <Link
                key={page.to}
                to={page.to}
                aria-current={isCurrent ? 'page' : undefined}
                className={`rounded transition-colors ${focusRing} ${
                  isCurrent
                    ? 'font-semibold text-emerald-800 underline decoration-emerald-700 decoration-2 underline-offset-8'
                    : 'hover:text-emerald-700'
                }`}
              >
                {page.label}
              </Link>
            );
          })}
          <a href={`#${PUBLIC_CONTACT_ANCHOR}`} className={`rounded transition-colors hover:text-emerald-700 ${focusRing}`}>
            Ayuda
          </a>
          <Link
            to="/auth"
            className={`inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-white transition-transform hover:scale-[1.01] ${focusRing}`}
          >
            Acceder
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </nav>

        {/* Móvil: la misma letra en los tres (el <button> no hereda el uppercase del <nav>, por eso
            se repite en cada uno). La página actual va rellena; «Reservar» es una acción, con borde
            y flecha, para que no parezca la página en la que estás. */}
        <nav aria-label="Principal" className="flex flex-wrap gap-1.5 md:hidden">
          <button
            type="button"
            onClick={handleReservar}
            className={`inline-flex items-center gap-1 rounded-full border border-emerald-700 bg-white px-2.5 py-2 text-xs font-semibold uppercase tracking-[0.04em] text-emerald-800 hover:bg-emerald-50 ${focusRing}`}
          >
            Reservar
            {/* Sin flecha por debajo de 375 px: así los tres caben en una fila también a 360 px. */}
            <ArrowRight className="hidden h-3.5 w-3.5 min-[375px]:block" aria-hidden="true" />
          </button>
          {NAV_PAGES.map((page) => {
            const isCurrent = pathname === page.to;
            return (
              <Link
                key={page.to}
                to={page.to}
                aria-current={isCurrent ? 'page' : undefined}
                className={`rounded-full border px-2.5 py-2 text-xs font-semibold uppercase tracking-[0.04em] ${focusRing} ${
                  isCurrent
                    ? 'border-emerald-700 bg-emerald-700 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                {page.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
};

export default PublicHeader;
