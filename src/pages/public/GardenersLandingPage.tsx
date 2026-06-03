import React, { useMemo } from 'react';
import { ArrowRight, Briefcase, CheckCircle2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import SeoHead from '../../components/common/SeoHead';
import MarketingImageSlot from '../../components/public/MarketingImageSlot';
import PublicFooter from '../../components/public/PublicFooter';
import PublicHeader from '../../components/public/PublicHeader';
import {
  PUBLIC_CONTACT_EMAIL,
  SITE_URL,
  gardenersContent,
  gardenersFaqs,
  pageSeo,
} from '../../config/publicSiteContent';
import { getMarketingAssetUrl } from '../../utils/marketingAssets';

const GardenersLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const seo = pageSeo.gardeners;

  const jsonLd = useMemo(
    () => [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: seo.title,
        url: new URL(seo.path, SITE_URL).toString(),
        about: 'Registro de jardineros y empresas de jardineria',
        inLanguage: 'es',
        provider: {
          '@type': 'Organization',
          name: 'GarSer',
          email: PUBLIC_CONTACT_EMAIL || undefined,
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
    [seo.path, seo.title],
  );

  const handleGardenerSignup = () => {
    navigate('/auth', {
      state: {
        initialMode: 'signup',
        preselectedRole: 'gardener',
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

      <main className="mx-auto max-w-7xl space-y-10 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <section className="grid gap-6 lg:grid-cols-[1.05fr,0.95fr]">
          <div className="rounded-[2rem] border border-emerald-100 bg-white p-6 shadow-[0_20px_60px_-45px_rgba(15,23,42,0.4)] sm:p-8 lg:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">{gardenersContent.eyebrow}</p>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">{gardenersContent.title}</h1>
            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">{gardenersContent.description}</p>

            <div className="mt-7 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleGardenerSignup}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/20 transition-transform hover:scale-[1.01]"
              >
                Registrarse como jardinero
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-900 transition-colors hover:border-emerald-200 hover:bg-emerald-50"
              >
                Volver al inicio
              </button>
            </div>
          </div>

          <MarketingImageSlot
            slot="gardeners.hero"
            alt={gardenersContent.title}
            priority
            sizes="(max-width: 1024px) 100vw, 40vw"
            placeholderLabel="Foto principal para la pagina de jardineros"
            className="min-h-[320px]"
            imageClassName="min-h-[320px] lg:min-h-[100%]"
          />
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {gardenersContent.benefits.map((benefit) => (
            <article key={benefit.title} className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Briefcase className="h-5 w-5" />
              </div>
              <h2 className="mt-5 text-xl font-semibold text-slate-950">{benefit.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-600">{benefit.description}</p>
            </article>
          ))}
        </section>

        <section className="grid gap-4 lg:grid-cols-[0.95fr,1.05fr]">
          <MarketingImageSlot
            slot="gardeners.process"
            alt="Proceso para jardineros"
            placeholderLabel="Foto para el proceso de alta profesional"
            className="min-h-[320px]"
            imageClassName="min-h-[320px] lg:min-h-[100%]"
          />

          <div className="rounded-[2rem] border border-slate-200 bg-slate-950 p-6 text-white sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">Como funciona</p>
            <div className="mt-6 space-y-6">
              {gardenersContent.process.map((step, index) => (
                <div key={step.title} className="flex gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-semibold">
                    {index + 1}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{step.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-300">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Lo que valoramos</p>
            <div className="mt-5 space-y-4">
              {[
                'Experiencia real en trabajos de jardineria residencial.',
                'Capacidad para completar bien el perfil y la solicitud.',
                'Seriedad en disponibilidad, herramientas y forma de trabajar.',
              ].map((item) => (
                <div key={item} className="flex gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                  <p className="text-sm leading-6 text-slate-700">{item}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-emerald-100 bg-gradient-to-br from-emerald-600 via-emerald-700 to-lime-700 p-6 text-white sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-50">Sobre GarSer</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight">{gardenersContent.finalCtaTitle}</h2>
            <p className="mt-4 text-base leading-7 text-emerald-50">{gardenersContent.finalCtaDescription}</p>
            <button
              type="button"
              onClick={handleGardenerSignup}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-emerald-800 transition-transform hover:scale-[1.01]"
            >
              Crear cuenta profesional
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </section>

        <section className="rounded-[2rem] border border-slate-200 bg-white p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">Preguntas frecuentes</p>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {gardenersFaqs.map((faq) => (
              <article key={faq.question} className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <h2 className="text-lg font-semibold text-slate-950">{faq.question}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-600">{faq.answer}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
};

export default GardenersLandingPage;
