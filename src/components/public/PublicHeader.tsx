import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import GarserLogo from '../common/GarserLogo';
import { clearBookingResumeStorage } from '../../utils/bookingResumeStorage';

const PublicHeader: React.FC = () => {
  const navigate = useNavigate();

  const handleReservar = () => {
    clearBookingResumeStorage({ flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-emerald-100/80 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4">
        <Link to="/" className="inline-flex items-center">
          <GarserLogo className="h-8 w-auto" textClassName="text-xl font-bold text-gray-900" />
        </Link>

          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.01] md:hidden"
          >
            Acceder
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          <button
            type="button"
            onClick={handleReservar}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-[1.01] hover:bg-emerald-800"
          >
            Reservar
            <ArrowRight className="h-4 w-4" />
          </button>
          <Link to="/marbella" className="transition-colors hover:text-emerald-700">
            Marbella
          </Link>
          <Link to="/para-jardineros" className="transition-colors hover:text-emerald-700">
            Para jardineros
          </Link>
          <Link
            to="/auth"
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-white transition-transform hover:scale-[1.01]"
          >
            Acceder
            <ArrowRight className="h-4 w-4" />
          </Link>
        </nav>

        <nav className="flex flex-wrap gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600 md:hidden">
          <button
            type="button"
            onClick={handleReservar}
            className="rounded-full bg-emerald-700 px-3 py-2 text-white hover:bg-emerald-800"
          >
            Reservar
          </button>
          <Link
            to="/marbella"
            className="rounded-full border border-slate-200 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
          >
            Marbella
          </Link>
          <Link
            to="/para-jardineros"
            className="rounded-full border border-slate-200 px-3 py-2 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
          >
            Jardineros
          </Link>
        </nav>
      </div>
    </header>
  );
};

export default PublicHeader;
