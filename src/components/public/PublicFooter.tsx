import React from 'react';
import { Link } from 'react-router-dom';

import { PUBLIC_CONTACT_EMAIL, costaDelSolZones } from '../../config/publicSiteContent';

const PublicFooter: React.FC = () => {
  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-200">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[1.2fr,1fr,1fr] lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">GarSer</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Reserva servicios de jardineria con una web pensada para clientes reales.</h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
            La portada publica y la zona de cliente comparten una misma idea: empezar una reserva rapido, retomarla si ya la dejaste abierta y no perderte entre pantallas tecnicas.
          </p>
          {PUBLIC_CONTACT_EMAIL ? (
            <a className="mt-5 inline-flex text-sm font-medium text-emerald-300 hover:text-emerald-200" href={`mailto:${PUBLIC_CONTACT_EMAIL}`}>
              {PUBLIC_CONTACT_EMAIL}
            </a>
          ) : null}
        </div>

        <div>
          <p className="text-sm font-semibold text-white">Enlaces utiles</p>
          <div className="mt-4 flex flex-col gap-3 text-sm text-slate-300">
            <a href="#reserva" className="hover:text-white">
              Empezar reserva
            </a>
            <Link to="/marbella" className="hover:text-white">
              Jardineria en Marbella
            </Link>
            <Link to="/para-jardineros" className="hover:text-white">
              Para jardineros
            </Link>
            <Link to="/auth" className="hover:text-white">
              Acceder
            </Link>
          </div>
        </div>

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
      </div>
    </footer>
  );
};

export default PublicFooter;
