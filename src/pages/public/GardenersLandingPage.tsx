import React, { useMemo } from 'react';
import {
  ArrowRight,
  Bell,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  MessageCircle,
  PencilLine,
  Repeat,
  Star,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import SeoHead from '../../components/common/SeoHead';
import AgendaMockup from '../../components/public/app-mockups/AgendaMockup';
import BookingLinkMockup from '../../components/public/app-mockups/BookingLinkMockup';
import BookingRequestMockup from '../../components/public/app-mockups/BookingRequestMockup';
import ClientBookingMockup from '../../components/public/app-mockups/ClientBookingMockup';
import TeamScheduleMockup from '../../components/public/app-mockups/TeamScheduleMockup';
import PublicFooter from '../../components/public/PublicFooter';
import PublicHeader from '../../components/public/PublicHeader';
import {
  SITE_URL,
  gardenersContent,
  gardenersFaqs,
  pageSeo,
} from '../../config/publicSiteContent';
import { useAppSettings } from '../../hooks/useAppSettings';
import { getMarketingAssetUrl } from '../../utils/marketingAssets';

/** Icono por línea de «Y además». La clave la trae el propio contenido en publicSiteContent.ts,
 * para no mezclar componentes de React dentro del archivo de textos. */
const extraIcons = {
  chat: MessageCircle,
  reviews: Star,
  repeat: Repeat,
  price: PencilLine,
  multiday: CalendarRange,
  done: CheckCircle2,
  alerts: Bell,
} as const;

/** Captura de la app que acompaña a cada paso de «Así funciona». */
const stepMockups = {
  agenda: AgendaMockup,
  link: BookingLinkMockup,
  client: ClientBookingMockup,
} as const;

const primaryButtonClass =
  'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-emerald-700 px-6 py-3 text-base font-semibold text-white shadow-sm transition-colors hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 [touch-action:manipulation]';

const GardenersLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const seo = pageSeo.gardeners;
  const { settings } = useAppSettings();
  const { hero, feeSplit, steps, extras, companies, finalCta } = gardenersContent;

  const jsonLd = useMemo(
    () => [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: seo.title,
        url: new URL(seo.path, SITE_URL).toString(),
        about: 'Registro de jardineros y empresas de jardinería',
        inLanguage: 'es',
        provider: {
          '@type': 'Organization',
          name: 'GarSer',
          email: settings.contactEmail || undefined,
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: gardenersFaqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Inicio',
            item: SITE_URL,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Para jardineros',
            item: new URL(seo.path, SITE_URL).toString(),
          },
        ],
      },
    ],
    [seo.path, seo.title, settings.contactEmail],
  );

  // Alta real: /auth en modo registro con la tarjeta de rol ya elegida. Después, el jardinero
  // pasa por /apply y la empresa por /empresa/solicitud; en ambos casos lo revisa el admin.
  const handleSignup = (role: 'gardener' | 'company') => {
    navigate('/auth', {
      state: {
        initialMode: 'signup',
        preselectedRole: role,
      },
    });
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f8fff8_0%,#ffffff_24%,#ffffff_100%)] text-slate-950">
      <SeoHead
        title={seo.title}
        description={seo.description}
        path={seo.path}
        ogImage={getMarketingAssetUrl(seo.ogImageSlot)}
        jsonLd={jsonLd}
      />

      <PublicHeader />

      <main className="mx-auto max-w-6xl px-4 pb-14 pt-6 sm:px-6 sm:pt-10 lg:px-8">
        {/* Hero: qué es, que es gratis y qué hacer, sin hacer scroll. */}
        <section className="grid grid-cols-1 items-center gap-8 lg:grid-cols-[1.1fr,0.9fr] lg:gap-14">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">{hero.eyebrow}</p>
            <h1 className="mt-3 text-[2rem] font-semibold leading-[1.15] tracking-tight text-slate-950 sm:text-5xl sm:leading-[1.08]">
              {hero.title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-600 sm:text-lg sm:leading-8">{hero.description}</p>

            <ul className="mt-5 space-y-2">
              {hero.highlights.map((highlight) => (
                <li key={highlight} className="flex items-start gap-2.5 text-[15px] font-medium leading-6 text-slate-800">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                  {highlight}
                </li>
              ))}
            </ul>

            <div className="mt-6">
              <button type="button" onClick={() => handleSignup('gardener')} className={`${primaryButtonClass} w-full sm:w-auto`}>
                {hero.primaryCtaLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="mt-2 text-sm text-slate-500">{hero.primaryCtaNote}</p>
            </div>

            <a
              href="#empresas"
              className="mt-4 inline-block text-sm font-semibold text-emerald-800 underline decoration-emerald-300 underline-offset-4 hover:decoration-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
            >
              {hero.companiesLinkLabel}
            </a>
          </div>

          <div className="mx-auto w-full max-w-sm">
            <BookingRequestMockup />
          </div>
        </section>

        {/* Quién paga qué: la diferencia entre tus clientes y los que trae GarSer, sin letra pequeña. */}
        <section id="sin-comision" aria-labelledby="sin-comision-title" className="mt-12 scroll-mt-40 sm:mt-20">
          <h2 id="sin-comision-title" className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {feeSplit.title}
          </h2>
          <p className="mt-2 text-base leading-7 text-slate-600">{feeSplit.intro}</p>

          <dl className="mt-5 divide-y divide-slate-200 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm sm:grid sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {feeSplit.rows.map((row) => (
              <div key={row.id} className="p-4 sm:p-6">
                <dt className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-lg font-semibold text-slate-950">{row.label}</span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                      row.id === 'own' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-slate-100 text-slate-700 ring-slate-200'
                    }`}
                  >
                    {row.badge}
                  </span>
                </dt>
                <dd className="mt-2 text-base leading-7 text-slate-600">
                  {row.who} <span className="font-semibold text-slate-900">{row.result}</span>
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-4 text-base leading-7 text-slate-700">{feeSplit.loyaltyNote}</p>
          <button
            type="button"
            onClick={() => handleSignup('gardener')}
            className="mt-3 inline-flex min-h-[44px] items-center gap-1.5 rounded text-base font-semibold text-emerald-800 hover:text-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [touch-action:manipulation]"
          >
            {hero.primaryCtaLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>

        {/* Así funciona: tres pasos, cada uno con su captura de la app. */}
        <section aria-labelledby="como-funciona-title" className="mt-12 sm:mt-20">
          <h2 id="como-funciona-title" className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {gardenersContent.stepsTitle}
          </h2>
          <ol className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3 lg:gap-8">
            {steps.map((step, index) => (
              <li key={step.title} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-sm font-semibold text-white"
                >
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-7 text-slate-950">{step.title}</h3>
                  <p className="mt-1 text-base leading-7 text-slate-600">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>

          {/* En el móvil, las capturas van en una tira que se desliza (como las capturas de una
              tienda de apps): el texto de los pasos queda entero a la vista y la sección no se
              estira tres pantallas. En escritorio, una captura bajo cada paso. */}
          <div
            role="region"
            aria-label="Capturas de la app, una por paso"
            tabIndex={0}
            className="-mx-4 mt-6 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green-500 sm:-mx-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-8 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden"
          >
            {steps.map((step, index) => {
              const Mockup = stepMockups[step.mockup];
              return (
                <figure key={step.mockup} className="w-[80%] max-w-[20rem] shrink-0 snap-center lg:w-auto lg:max-w-none">
                  <Mockup />
                  <figcaption className="mt-2 px-1 text-sm font-medium text-slate-500 lg:hidden">
                    {index + 1}. {step.caption}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </section>

        {/* Y además: el resto de funciones en una lista compacta, sin tarjetas. */}
        <section aria-labelledby="extras-title" className="mt-12 sm:mt-20">
          <h2 id="extras-title" className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {gardenersContent.extrasTitle}
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {extras.map((extra) => {
              const Icon = extraIcons[extra.icon];
              return (
                <li key={extra.icon} className="flex items-start gap-3 text-base leading-7 text-slate-700">
                  <Icon className="mt-1 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
                  {extra.text}
                </li>
              );
            })}
          </ul>
        </section>

        {/* Empresas: solo lo que añade sobre el autónomo (equipo, empleados, reparto). */}
        <section
          id="empresas"
          aria-labelledby="empresas-title"
          className="mt-12 scroll-mt-40 rounded-3xl bg-slate-950 px-5 py-8 text-white sm:mt-20 sm:px-8 sm:py-10 lg:grid lg:grid-cols-[1fr,0.85fr] lg:items-center lg:gap-12"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{companies.eyebrow}</p>
            <h2 id="empresas-title" className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
              {companies.title}
            </h2>
            <p className="mt-3 text-base leading-7 text-slate-300">{companies.intro}</p>
            <ul className="mt-4 space-y-3">
              {companies.points.map((point) => (
                <li key={point} className="flex items-start gap-3 text-base leading-7 text-slate-100">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
                  {point}
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => handleSignup('company')}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-base font-semibold text-emerald-800 transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 sm:w-auto [touch-action:manipulation]"
              >
                {companies.ctaLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <p className="mt-2 text-sm text-slate-400">{companies.ctaNote}</p>
            </div>
          </div>
          <div className="mx-auto mt-8 w-full max-w-sm lg:mt-0">
            <TeamScheduleMockup />
          </div>
        </section>

        {/* Preguntas frecuentes: plegables nativos, sin estado de React. */}
        <section aria-labelledby="faq-title" className="mx-auto mt-12 max-w-3xl sm:mt-20">
          <h2 id="faq-title" className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            {gardenersContent.faqTitle}
          </h2>
          <div className="mt-5 divide-y divide-slate-200 rounded-3xl border border-slate-200 bg-white px-5 shadow-sm">
            {gardenersFaqs.map((faq) => (
              <details key={faq.question} className="group">
                <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-4 rounded py-3 text-base font-semibold text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 [&::-webkit-details-marker]:hidden">
                  {faq.question}
                  <ChevronDown
                    className="h-5 w-5 shrink-0 text-slate-500 transition-transform group-open:rotate-180 motion-reduce:transition-none"
                    aria-hidden="true"
                  />
                </summary>
                <p className="pb-4 text-base leading-7 text-slate-600">{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Cierre: la misma acción principal, una última vez. */}
        <section className="mt-12 rounded-3xl border border-emerald-100 bg-emerald-50 px-5 py-7 sm:mt-20 sm:flex sm:items-center sm:justify-between sm:gap-8 sm:px-8">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">{finalCta.title}</h2>
            <p className="mt-2 text-base leading-7 text-slate-700">{finalCta.description}</p>
          </div>
          <button
            type="button"
            onClick={() => handleSignup('gardener')}
            className={`${primaryButtonClass} mt-5 w-full shrink-0 sm:mt-0 sm:w-auto`}
          >
            {hero.primaryCtaLabel}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
};

export default GardenersLandingPage;
