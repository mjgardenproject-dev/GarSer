import React from 'react';
import { CalendarClock, Euro, MapPin, Users } from 'lucide-react';

// Bienvenida del cuestionario «Activa tu cuenta». El texto es el que pidió el propietario (2026-11-11);
// para un autónomo, «tu empresa» pasa a «tu negocio».

interface Props {
  firstName: string;
  isCompany: boolean;
  minutes: number;
}

const BLOCKS = [
  { icon: MapPin, title: 'Tu zona', detail: 'Dónde trabajas y hasta dónde te desplazas.' },
  { icon: Euro, title: 'Servicios y tarifas', detail: 'Qué haces y cuánto cobras, con preguntas sencillas.' },
  { icon: CalendarClock, title: 'Tu horario', detail: 'Cuándo pueden reservarte.' },
  { icon: Users, title: 'Tu equipo', detail: 'Si trabajas con más personas, invítalas.' },
];

const WelcomeStep: React.FC<Props> = ({ firstName, isCompany, minutes }) => {
  const business = isCompany ? 'tu empresa' : 'tu negocio';
  return (
    <div>
      <h1 className="text-2xl font-bold leading-tight text-gray-900">
        Hola{firstName ? ` ${firstName}` : ''}, configura todo lo necesario para que {business} funcione en GarSer a la perfección
      </h1>
      <p className="mt-3 text-base text-gray-700">
        Este cuestionario es el último paso para disfrutar de las ventajas de garser.es. Todo lo configurado podrá
        editarse después desde tu configurador.
      </p>
      <p className="mt-4 text-sm font-semibold text-emerald-800">Tardarás unos {minutes} minutos.</p>
      <ol className="mt-5 space-y-3">
        {BLOCKS.map(({ icon: Icon, title, detail }, index) => (
          <li key={title} className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-gray-900">
                {index + 1}. {title}
              </span>
              <span className="block text-sm text-gray-600">{detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
};

export default WelcomeStep;
