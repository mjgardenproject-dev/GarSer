import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import SeoHead from '../../components/common/SeoHead';
import CustomerExperienceSections from '../../components/public/CustomerExperienceSections';
import PublicFooter from '../../components/public/PublicFooter';
import PublicHeader from '../../components/public/PublicHeader';
import {
  PUBLIC_CONTACT_EMAIL,
  SITE_URL,
  costaDelSolZones,
  generalHomeFaqs,
  pageSeo,
} from '../../config/publicSiteContent';
import { clearBookingResumeStorage, hasWizardResume } from '../../utils/bookingResumeStorage';
import { getMarketingAssetUrl } from '../../utils/marketingAssets';

const PublicHomePage: React.FC = () => {
  const navigate = useNavigate();
  const canResume = hasWizardResume({ allowAnonFallback: true });
  const seo = pageSeo.general;

  const jsonLd = useMemo(
    () => [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'GarSer',
        url: SITE_URL,
        email: PUBLIC_CONTACT_EMAIL || undefined,
        areaServed: costaDelSolZones,
      },
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: generalHomeFaqs.map((faq) => ({
          '@type': 'Question',
          name: faq.question,
          acceptedAnswer: {
            '@type': 'Answer',
            text: faq.answer,
          },
        })),
      },
    ],
    [],
  );

  const handleNewBooking = () => {
    clearBookingResumeStorage({ flow: 'wizard', includeAnonFallback: true });
    navigate('/reservar?start=1');
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

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <CustomerExperienceSections
          pageVariant="general"
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

export default PublicHomePage;
