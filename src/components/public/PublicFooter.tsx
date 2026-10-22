import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, MessageCircle, Phone } from 'lucide-react';

import { PUBLIC_CONTACT_ANCHOR, PUBLIC_WHATSAPP_NUMBER, PUBLIC_WHATSAPP_URL } from '../../config/publicSiteContent';
import { COOKIES_PATH, PRIVACY_PATH, TERMS_PATH } from '../../config/legal';
import { useAppSettings } from '../../hooks/useAppSettings';
import { clearWizardDraftsForFreshStart } from '../../utils/bookingResumeStorage';

const PublicFooter: React.FC = () => {
  const { settings } = useAppSettings();
  const navigate = useNavigate();
  // Por defecto info@garser.es (PUBLIC_CONTACT_EMAIL); el admin puede cambiarlo en Ajustes.
  const contactEmail = settings.contactEmail;
  const contactPhone = settings.contactPhone;
  const phoneHref = contactPhone ? `tel:${contactPhone.replace(/\s+/g, '')}` : '';

  const handleReservar = () => {
    clearWizardDraftsForFreshStart();
    navigate('/reservar?start=1');
  };

  return (
    <footer className="border-t border-slate-200 bg-slate-950 text-slate-200">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.3fr,1fr,0.8fr] lg:gap-8 lg:px-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">GarSer</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Reserva servicios de jardinería con una web pensada para clientes reales.</h2>
          <p className="mt-4 max-w-xl text-sm leading-6 text-slate-400">
            La portada pública y la zona de cliente comparten una misma idea: empezar una reserva rápido, retomarla si ya la dejaste abierta y no perderte entre pantallas técnicas.
          </p>
        </div>

        {/* scroll-mt: que la cabecera fija (hasta ~150 px en el móvil) no tape el título al llegar desde «Ayuda». */}
        <section id={PUBLIC_CONTACT_ANCHOR} aria-labelledby="contacto-title" className="scroll-mt-40">
          <h2 id="contacto-title" className="text-sm font-semibold text-white">Contacto y ayuda</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">¿Dudas con una reserva o con tu cuenta? Escríbenos.</p>
          <div className="mt-4 flex flex-col gap-3">
            <a
              href={PUBLIC_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] w-fit items-center gap-2 rounded-full bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              <MessageCircle className="h-4 w-4" aria-hidden="true" />
              WhatsApp {PUBLIC_WHATSAPP_NUMBER}
            </a>
            {contactEmail ? (
              <a
                href={`mailto:${contactEmail}`}
                className="inline-flex min-h-[44px] w-fit items-center gap-2 text-sm font-medium text-emerald-300 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                {contactEmail}
              </a>
            ) : null}
            {contactPhone ? (
              <a
                href={phoneHref}
                className="inline-flex min-h-[44px] w-fit items-center gap-2 text-sm font-medium text-emerald-300 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
              >
                <Phone className="h-4 w-4" aria-hidden="true" />
                {contactPhone}
              </a>
            ) : null}
          </div>
        </section>

        <div>
          <p className="text-sm font-semibold text-white">Enlaces útiles</p>
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
              Soy jardinero
            </Link>
            <Link to="/auth" className="hover:text-white">
              Acceder
            </Link>
            <Link to={PRIVACY_PATH} className="hover:text-white">
              Privacidad
            </Link>
            <Link to={TERMS_PATH} className="hover:text-white">
              Términos y condiciones
            </Link>
            <Link to={COOKIES_PATH} className="hover:text-white">
              Cookies
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default PublicFooter;
