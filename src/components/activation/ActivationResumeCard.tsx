import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket } from 'lucide-react';
import { resumeActivation } from '../../activation/activationFlow';

// Tarjeta del panel mientras el profesional no ha terminado «Activa tu cuenta» y la ha pausado
// (2026-11-11): le recuerda que le falta poco y le lleva de vuelta donde lo dejó.

const ActivationResumeCard: React.FC<{ className?: string }> = ({ className = '' }) => {
  const navigate = useNavigate();
  return (
    <section className={`rounded-2xl border border-emerald-200 bg-emerald-50 p-4 sm:p-5 ${className}`} aria-labelledby="activation-resume-title">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-white">
          <Rocket className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="activation-resume-title" className="font-bold text-gray-900">
            Te falta poco para activar tu cuenta
          </h2>
          <p className="mt-0.5 text-sm text-gray-700">Termina el cuestionario y empieza a recibir reservas. Lo que ya hiciste está guardado.</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => {
          resumeActivation();
          navigate('/activar');
        }}
        className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-base font-bold text-white hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 [touch-action:manipulation]"
      >
        Continuar donde lo dejé
      </button>
    </section>
  );
};

export default ActivationResumeCard;
