import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import SeoHead from '../../components/common/SeoHead';
import CustomerExperienceSections from '../../components/public/CustomerExperienceSections';
import PublicFooter from '../../components/public/PublicFooter';
import PublicHeader from '../../components/public/PublicHeader';
import { PUBLIC_CONTACT_EMAIL, SITE_URL, marbellaFaqs, pageSeo } from '../../config/publicSiteContent';
import { clearBookingResumeStorage, hasWizardResume } from '../../utils/bookingResumeStorage';
import { getMarketingAssetUrl } from '../../utils/marketingAssets';

const MarbellaLandingPage: React.FC = () => {
  const navigate = useNavigate();
  const canResume = hasWizardResume({ allowAnonFallback: true });
  const seo = pageSeo.marbella;

  const jsonLd = useMemo(
    () => [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: seo.title,
        url: new URL(seo.path, SITE_URL).toString(),
        about: 'Jardineria en Marbella',
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
        mainEntity: marbellaFaqs.map((faq) => ({
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
            name: 'Marbella',
            item: new URL(seo.path, SITE_URL).toString(),
          },
        ],
      },
    ],
    [seo.path, seo.title],
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
          pageVariant="marbella"
          canResumeBooking={canResume}
          showAccessCta
          showBookingsCta={false}
          onPrimaryCta={handleNewBooking}
          onResumeCta={() => navigate('/reservar')}
          onAccessCta={() => navigate('/auth')}
        />
      </main>

      <PublicFooter />
    </div>
  );
};

export default MarbellaLandingPage;
