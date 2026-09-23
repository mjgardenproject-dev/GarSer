import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { costaDelSolZones } from '../../config/publicSiteContent';
import { useAppSettings } from '../../hooks/useAppSettings';
import { clearBookingResumeStorage } from '../../utils/bookingResumeStorage';

interface PublicFooterProps {
  /** Muestra las chips de cobertura de Costa del Sol. Solo tiene sentido en páginas
   * cuyo enfoque local es intencionado (Marbella, Costa del Sol) — no en Home ni en
   * la landing de jardineros, que no están limitadas a una zona. */
  showCoverageZones?: boolean;
}

const PublicFooter: React.FC<PublicFooterProps> = ({ showCoverageZones = false }) => {
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  const contactEmail = settings.contactEmail;
  const contactPhone = settings.contactPhone;
  const phoneHref = contactPhone ? `tel:${contactPhone.replace(/\s+/g, '')}` : '';

  const handleReservar = () => {
    clearBookingResumeStorage({ flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
  };

  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-200">
      <div
        className={`mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:px-8 ${
          showCoverageZones ? 'lg:grid-cols-[1.2fr,1fr,1fr]' : 'lg:grid-cols-[1.4fr,1fr]'
        }`}
      >
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">GarSer</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Reserva servicios de jardinería con una web pensada para clientes reales.</h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
            La portada pública y la zona de cliente comparten una misma idea: empezar una reserva rápido, retomarla si ya la dejaste abierta y no perderte entre pantallas técnicas.
          </p>
          <div className="mt-5 flex flex-col gap-2">
            {contactEmail ? (
              <a className="inline-flex w-fit text-sm font-medium text-emerald-300 hover:text-emerald-200" href={`mailto:${contactEmail}`}>
                {contactEmail}
              </a>
            ) : null}
            {contactPhone ? (
              <a className="inline-flex w-fit text-sm font-medium text-emerald-300 hover:text-emerald-200" href={phoneHref}>
                {contactPhone}
              </a>
            ) : null}
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Enlaces utiles</p>
          <div className="mt-4 flex flex-col gap-3 text-sm text-slate-300">
            <button type="button" onClick={handleReservar} className="text-left hover:text-white">
              Empezar reserva
            </button>
            <Link to="/costa-del-sol" className="hover:text-white">
              Jardinería en la Costa del Sol
            </Link>
            <Link to="/marbella" className="hover:text-white">
              Jardinería en Marbella
            </Link>
            <Link to="/para-jardineros" className="hover:text-white">
              Para jardineros
            </Link>
            <Link to="/auth" className="hover:text-white">
              Acceder
            </Link>
          </div>
        </div>

        {showCoverageZones ? (
          <div>
            <p className="text-sm font-semibold text-white">Cobertura orientativa</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {costaDelSolZones.map((zone) => (
                <span key={zone} className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1 text-xs text-slate-300">
                  {zone}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </footer>
  );
};

export default PublicFooter;
