import React from 'react';
import { ArrowRight, Briefcase, CheckCircle2, ClipboardList, MapPin, RefreshCcw } from 'lucide-react';
import { Link } from 'react-router-dom';

import MarketingImageSlot from './MarketingImageSlot';
import {
  costaDelSolContent,
  costaDelSolFaqs,
  costaDelSolZones,
  generalHomeContent,
  generalHomeFaqs,
  marbellaContent,
  marbellaFaqs,
  serviceHighlights,
} from '../../config/publicSiteContent';

type CustomerExperienceSectionsProps = {
  pageVariant: 'general' | 'marbella' | 'costa-del-sol' | 'client-dashboard';
  canResumeBooking: boolean;
  showBookingsCta: boolean;
  onPrimaryCta: () => void;
  onResumeCta: () => void;
  onBookingsCta?: () => void;
  /** Nombre de la zona en las páginas locales ("la Costa del Sol"). Cuando se pasa, los
   * encabezados de servicio se localizan ("Corte de césped en la Costa del Sol"), que es
   * lo que da valor SEO a una landing de zona. Las páginas sin zona no lo pasan. */
  locationLabel?: string;
};

const CustomerExperienceSections: React.FC<CustomerExperienceSectionsProps> = ({
  pageVariant,
  canResumeBooking,
  showBookingsCta,
  onPrimaryCta,
  onResumeCta,
  onBookingsCta,
  locationLabel,
}) => {
  const isMarbella = pageVariant === 'marbella';
  const isCostaDelSol = pageVariant === 'costa-del-sol';
  /** Las páginas de zona comparten estructura y solo cambian el bloque de contenido. */
  const isLocalPage = isMarbella || isCostaDelSol;
  const localContent = isMarbella ? marbellaContent : costaDelSolContent;
  const hero = isMarbella ? marbellaContent : isCostaDelSol ? costaDelSolContent : generalHomeContent;
  const faqs = isMarbella ? marbellaFaqs : isCostaDelSol ? costaDelSolFaqs : generalHomeFaqs;

  return (
    <div className="space-y-10 pb-16 sm:space-y-14">
      <section>
        <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.4)] sm:p-8 lg:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">{hero.eyebrow}</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
            {hero.title}
          </h1>
          {isLocalPage ? (
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              {localContent.description}
            </p>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              id="reserva"
              type="button"
              onClick={onPrimaryCta}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-700/20 transition-transform hover:scale-[1.01]"
            >
              {generalHomeContent.primaryCtaLabel}
              <ArrowRight className="h-4 w-4" />
            </button>

            {canResumeBooking ? (
              <button
                type="button"
                onClick={onResumeCta}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-emerald-200 hover:bg-emerald-50"
              >
                <RefreshCcw className="h-4 w-4" />
                {generalHomeContent.resumeCtaLabel}
              </button>
            ) : null}

            {showBookingsCta && onBookingsCta ? (
              <button
                type="button"
                onClick={onBookingsCta}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-emerald-200 hover:bg-emerald-50"
              >
                <ClipboardList className="h-4 w-4" />
                {generalHomeContent.bookingsCtaLabel}
              </button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Servicios destacados</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              {locationLabel ? `Servicios disponibles para ${locationLabel}` : 'Trabajos habituales para viviendas con jardín'}
            </h2>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {serviceHighlights.map((service) => {
            const serviceHeading = locationLabel ? `${service.title} en ${locationLabel}` : service.title;
            return (
            <article key={service.id} className="overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-sm">
              <MarketingImageSlot
                slot={service.imageSlot}
                alt={serviceHeading}
                placeholderLabel={`Foto para ${service.title.toLowerCase()}`}
                className="h-56 rounded-none"
                imageClassName="h-56"
              />
              <div className="space-y-3 p-5">
                <h3 className="text-xl font-semibold text-slate-950">{serviceHeading}</h3>
                <p className="text-sm leading-6 text-slate-600">{service.description}</p>
                <button
                  type="button"
                  onClick={onPrimaryCta}
                  className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
                >
                  Reservar este servicio
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </article>
            );
          })}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr,1.1fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Como funciona</p>
          <div className="mt-6 space-y-6">
            {generalHomeContent.howItWorks.map((step, index) => (
              <div key={step.title} className="flex gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                  {index + 1}
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-emerald-100 bg-white">
          <div className="grid gap-0 lg:grid-cols-[0.85fr,1.15fr]">
            <MarketingImageSlot
              slot="home.coverage"
              alt={isLocalPage ? 'Cobertura de jardinería en Costa del Sol' : 'Jardinero profesional de GarSer trabajando'}
              placeholderLabel={isLocalPage ? 'Foto de cobertura Costa del Sol' : 'Foto de jardineros GarSer'}
              className="h-full rounded-none"
              imageClassName="min-h-[260px] lg:min-h-full"
            />
            <div className="p-6 sm:p-8">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">{hero.coverageTitle}</p>
              <p className="mt-4 text-base leading-7 text-slate-600">{hero.coverageDescription}</p>
              {isLocalPage ? (
                <div className="mt-6 flex flex-wrap gap-2">
                  {costaDelSolZones.map((zone) => (
                    <span key={zone} className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">
                      <MapPin className="mr-2 h-3.5 w-3.5" />
                      {zone}
                    </span>
                  ))}
                </div>
              ) : null}
              {!isMarbella ? (
                <button
                  type="button"
                  onClick={onPrimaryCta}
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-700/20 transition-transform hover:scale-[1.01]"
                >
                  <MapPin className="h-4 w-4" />
                  {generalHomeContent.findGardenersCtaLabel}
                </button>
              ) : null}
              {pageVariant === 'general' ? (
                <p className="mt-4 text-sm text-slate-500">
                  ¿Tu jardín está en la Costa del Sol?{' '}
                  <Link to="/costa-del-sol" className="font-semibold text-emerald-700 underline-offset-2 hover:underline">
                    Ver cobertura y servicios en la zona
                  </Link>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr]">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">{generalHomeContent.faqTitle}</p>
          <div className="mt-6 space-y-4">
            {faqs.map((faq) => (
              <article key={faq.question} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h3 className="text-lg font-semibold text-slate-950">{faq.question}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{faq.answer}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-emerald-600 via-emerald-700 to-lime-700 p-6 text-white sm:p-8">
          {isLocalPage ? (
            <>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-50">
                <CheckCircle2 className="h-4 w-4" />
                Reserva más clara
              </p>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight">{localContent.finalCtaTitle}</h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-emerald-50">{localContent.finalCtaDescription}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={onPrimaryCta}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-emerald-800 transition-transform hover:scale-[1.01]"
                >
                  {generalHomeContent.primaryCtaLabel}
                  <ArrowRight className="h-4 w-4" />
                </button>
                {canResumeBooking ? (
                  <button
                    type="button"
                    onClick={onResumeCta}
                    className="inline-flex items-center gap-2 rounded-full border border-white/30 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                  >
                    {generalHomeContent.resumeCtaLabel}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <p className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-50">
                <Briefcase className="h-4 w-4" />
                {generalHomeContent.gardenerCtaBadge}
              </p>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight">{generalHomeContent.gardenerCtaTitle}</h2>
              <p className="mt-4 max-w-xl text-base leading-7 text-emerald-50">{generalHomeContent.gardenerCtaDescription}</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/para-jardineros"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-emerald-800 transition-transform hover:scale-[1.01]"
                >
                  {generalHomeContent.gardenerCtaButtonLabel}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default CustomerExperienceSections;
