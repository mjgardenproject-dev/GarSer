import { useEffect } from 'react';

import { SITE_URL } from '../../config/publicSiteContent';

type SeoHeadProps = {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
};

const META_KEY = 'data-seo-managed';

const upsertMeta = (selector: string, attributes: Record<string, string>) => {
  let element = document.head.querySelector(selector) as HTMLMetaElement | null;

  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(META_KEY, 'true');
    document.head.appendChild(element);
  }

  Object.entries(attributes).forEach(([key, value]) => {
    element?.setAttribute(key, value);
  });
};

const upsertCanonical = (href: string) => {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;

  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    link.setAttribute(META_KEY, 'true');
    document.head.appendChild(link);
  }

  link.href = href;
};

const upsertJsonLd = (payload: SeoHeadProps['jsonLd']) => {
  const scriptId = 'seo-jsonld';
  const existing = document.getElementById(scriptId);

  if (!payload) {
    existing?.remove();
    return;
  }

  const script = existing || document.createElement('script');
  script.id = scriptId;
  script.setAttribute('type', 'application/ld+json');
  script.setAttribute(META_KEY, 'true');
  script.textContent = JSON.stringify(payload);

  if (!existing) {
    document.head.appendChild(script);
  }
};

const SeoHead = ({ title, description, path, ogImage, jsonLd }: SeoHeadProps) => {
  useEffect(() => {
    const canonicalUrl = new URL(path, SITE_URL).toString();
    const socialImage = ogImage || new URL('/favicon.svg', SITE_URL).toString();

    document.title = title;

    upsertMeta('meta[name="description"]', {
      name: 'description',
      content: description,
    });
    upsertMeta('meta[property="og:title"]', {
      property: 'og:title',
      content: title,
    });
    upsertMeta('meta[property="og:description"]', {
      property: 'og:description',
      content: description,
    });
    upsertMeta('meta[property="og:type"]', {
      property: 'og:type',
      content: 'website',
    });
    upsertMeta('meta[property="og:url"]', {
      property: 'og:url',
      content: canonicalUrl,
    });
    upsertMeta('meta[property="og:image"]', {
      property: 'og:image',
      content: socialImage,
    });
    upsertMeta('meta[name="twitter:card"]', {
      name: 'twitter:card',
      content: 'summary_large_image',
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: 'twitter:title',
      content: title,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: 'twitter:description',
      content: description,
    });
    upsertMeta('meta[name="twitter:image"]', {
      name: 'twitter:image',
      content: socialImage,
    });

    upsertCanonical(canonicalUrl);
    upsertJsonLd(jsonLd);

    return () => {
      upsertJsonLd(undefined);
    };
  }, [description, jsonLd, ogImage, path, title]);

  return null;
};

export default SeoHead;
