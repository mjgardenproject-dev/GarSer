import React from 'react';
import { useNavigate } from 'react-router-dom';
import { HelpCircle, Mail, MessageCircle, RotateCcw } from 'lucide-react';
import BottomSheet from '../common/BottomSheet';
import { usePublicBillingTerms } from '../../hooks/usePublicBillingTerms';
import { gardenersFaqs } from '../../config/billingCopy';
import { PUBLIC_CONTACT_EMAIL, PUBLIC_WHATSAPP_NUMBER, PUBLIC_WHATSAPP_URL } from '../../config/publicSiteContent';
import { resumeActivation } from '../../activation/activationFlow';

// «Ayuda» del panel del profesional (2026-11-11, decisión D4). Sustituye a la guía de pasos como sitio al que
// acudir: contacto, preguntas frecuentes del profesional y repetir el cuestionario «Activa tu cuenta».
// Lo que dice quién paga gastos de gestión sale de billingCopy.ts (cambia con los ajustes), nunca fijo.

const PROFESSIONAL_FAQS = [
  {
    question: '¿Cómo se calcula el precio que ve el cliente?',
    answer:
      'Con tus tarifas y los datos del trabajo (metros, unidades, altura, estado y si quiere que te lleves los restos). Si sale por menos de tu mínimo, se cobra tu mínimo. Puedes verlo con ejemplos repitiendo el cuestionario.',
  },
  {
    question: '¿Cómo cambio mis precios o mi horario?',
    answer: 'En «Mi perfil → Servicios» y en «Horario». Los cambios valen para las reservas nuevas; las ya hechas mantienen su precio.',
  },
  {
    question: '¿Qué pasa si tengo que cancelar un trabajo?',
    answer:
      'Si cancelas un trabajo que ya aceptaste, al cliente se le devuelve lo que pagó y tu perfil recibe una valoración de 1 estrella. Si no puedes hacerlo, mejor rechaza la solicitud antes de aceptarla.',
  },
  {
    question: '¿Necesito carnet de aplicador?',
    answer: 'Solo para tratamientos fitosanitarios químicos y para el herbicida del desbroce. Súbelo en «Mi perfil»: GarSer lo revisa y te avisa.',
  },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

const ProfessionalHelpSheet: React.FC<Props> = ({ open, onClose }) => {
  const navigate = useNavigate();
  const terms = usePublicBillingTerms();
  // Las de quién paga qué, cobros y equipo, con los ajustes vigentes (las de registro e instalación sobran aquí).
  const billingFaqs = gardenersFaqs(terms).filter((faq) => !/registrarse|instalar/i.test(faq.question));
  const faqs = [...PROFESSIONAL_FAQS, ...billingFaqs];

  return (
    <BottomSheet open={open} onClose={onClose} title="Ayuda" description="Escríbenos o mira las preguntas más habituales.">
      <div className="grid grid-cols-2 gap-2">
        <a
          href={PUBLIC_WHATSAPP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-2 py-2 text-center text-sm font-semibold text-gray-900 hover:bg-gray-50"
        >
          <MessageCircle className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          WhatsApp
          <span className="text-xs font-normal text-gray-600">{PUBLIC_WHATSAPP_NUMBER}</span>
        </a>
        <a
          href={`mailto:${PUBLIC_CONTACT_EMAIL}`}
          className="flex min-h-14 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-2 py-2 text-center text-sm font-semibold text-gray-900 hover:bg-gray-50"
        >
          <Mail className="h-5 w-5 text-emerald-700" aria-hidden="true" />
          Correo
          <span className="text-xs font-normal text-gray-600">{PUBLIC_CONTACT_EMAIL}</span>
        </a>
      </div>

      <h3 className="mt-5 text-sm font-bold uppercase tracking-wide text-gray-500">Preguntas frecuentes</h3>
      <div className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
        {faqs.map((faq) => (
          <details key={faq.question} className="group px-3 py-1">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-gray-900">
              {faq.question}
              <span aria-hidden="true" className="text-gray-400 transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="pb-3 text-sm text-gray-700">{faq.answer}</p>
          </details>
        ))}
      </div>

      <button
        type="button"
        onClick={() => {
          resumeActivation();
          onClose();
          navigate('/activar');
        }}
        className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 font-semibold text-gray-900 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
      >
        <RotateCcw className="h-5 w-5" aria-hidden="true" /> Repetir el cuestionario de activación
      </button>
    </BottomSheet>
  );
};

/** Botón «Ayuda» para la cabecera de los paneles. */
export const HelpButton: React.FC<{ onClick: () => void; className?: string }> = ({ onClick, className = '' }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [touch-action:manipulation] ${className}`}
  >
    <HelpCircle className="h-4 w-4" aria-hidden="true" /> Ayuda
  </button>
);

export default ProfessionalHelpSheet;
