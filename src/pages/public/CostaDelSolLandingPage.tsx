import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import SeoHead from '../../components/common/SeoHead';
import CustomerExperienceSections from '../../components/public/CustomerExperienceSections';
import PublicFooter from '../../components/public/PublicFooter';
import PublicHeader from '../../components/public/PublicHeader';
import { SITE_URL, costaDelSolFaqs, costaDelSolZones, pageSeo } from '../../config/publicSiteContent';
import { useAppSettings } from '../../hooks/useAppSettings';
import { clearBookingResumeStorage, hasWizardResume } from '../../utils/bookingResumeStorage';
import { getMarketingAssetUrl } from '../../utils/marketingAssets';

const CostaDelSolLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const canResume = hasWizardResume({ allowAnonFallback: true });
  const seo = pageSeo.costaDelSol;
  const { settings } = useAppSettings();

  const jsonLd = useMemo(
    () => [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: seo.title,
        url: new URL(seo.path, SITE_URL).toString(),
        about: 'Jardinería en la Costa del Sol',
        inLanguage: 'es',
        provider: {
          '@type': 'Organization',
          name: 'GarSer',
          email: settings.contactEmail || undefined,
          areaServed: costaDelSolZones,
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: costaDelSolFaqs.map((faq) => ({
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
            name: 'Costa del Sol',
            item: new URL(seo.path, SITE_URL).toString(),
          },
        ],
      },
    ],
    [seo.path, seo.title, settings.contactEmail],
  );

  const handleNewBooking = () => {
    clearBookingResumeStorage({ flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
  };

  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#f6fff8_0%,#ffffff_28%,#ffffff_100%)] text-slate-950">
      <SeoHead
        title={seo.title}
        description={seo.description}
        path={seo.path}
        ogImage={getMarketingAssetUrl(seo.ogImageSlot)}
        jsonLd={jsonLd}
      />

      <PublicHeader />

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <CustomerExperienceSections
          pageVariant="costa-del-sol"
          locationLabel="la Costa del Sol"
          canResumeBooking={canResume}
          showBookingsCta={false}
          onPrimaryCta={handleNewBooking}
          onResumeCta={() => navigate('/reservar')}
        />
      </main>

      <PublicFooter showCoverageZones />
    </div>
  );
};

export default CostaDelSolLandingPage;
