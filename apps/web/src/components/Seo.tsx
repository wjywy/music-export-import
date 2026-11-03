import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  absoluteUrl,
  buildStructuredData,
  OG_IMAGE_ALT,
  OG_IMAGE_URL,
  pageTitle,
  ROBOTS_INDEX,
  SITE,
  type Crumb,
  type FaqEntry,
} from '../lib/seo';

type SeoProps = {
  /** Page name without the “· 渡口 Dukou” suffix. Omit for the landing page. */
  title?: string;
  description: string;
  /** Router-relative path; defaults to the current location. */
  path?: string;
  robots?: string;
  image?: string;
  crumbs?: Crumb[];
  faq?: FaqEntry[];
  includeApp?: boolean;
};

const JSON_LD_ID = 'seo-structured-data';

function setMeta(attribute: 'name' | 'property', key: string, content: string) {
  const existing = document.head.querySelector<HTMLMetaElement>(
    `meta[${attribute}="${key}"]`,
  );
  const tag = existing ?? document.createElement('meta');
  if (!existing) {
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function setLink(
  rel: string,
  href: string,
  hreflang?: string,
): HTMLLinkElement {
  const selector = hreflang
    ? `link[rel="${rel}"][hreflang="${hreflang}"]`
    : `link[rel="${rel}"]:not([hreflang])`;
  const existing = document.head.querySelector<HTMLLinkElement>(selector);
  const tag = existing ?? document.createElement('link');
  if (!existing) {
    tag.rel = rel;
    if (hreflang) tag.hreflang = hreflang;
    document.head.appendChild(tag);
  }
  tag.href = href;
  return tag;
}

function setStructuredData(value: unknown) {
  const payload = JSON.stringify(value).replace(/</g, '\\u003c');
  let script = document.getElementById(JSON_LD_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = JSON_LD_ID;
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }
  if (script.textContent !== payload) script.textContent = payload;
}

/**
 * Keeps the document head in sync with the current route without adding a
 * runtime dependency: static tags in index.html are updated in place, so
 * crawlers that do not execute JavaScript still see the landing page tags.
 */
export function Seo({
  title,
  description,
  path,
  robots = ROBOTS_INDEX,
  image = OG_IMAGE_URL,
  crumbs,
  faq,
  includeApp = false,
}: SeoProps) {
  const location = useLocation();
  const routePath = path ?? location.pathname ?? '/';
  const fullTitle = pageTitle(title);
  const canonical = absoluteUrl(routePath);
  // Props are often inline arrays; only rebuild the graph when their content
  // actually changes, not on every render (e.g. each keystroke in a form).
  const crumbsKey = crumbs ? JSON.stringify(crumbs) : '';
  const faqKey = faq ? JSON.stringify(faq) : '';

  useEffect(() => {
    document.title = fullTitle;
    document.documentElement.lang = SITE.language;

    setMeta('name', 'description', description);
    setMeta('name', 'robots', robots);
    setMeta('name', 'application-name', SITE.name);
    setMeta('name', 'apple-mobile-web-app-title', SITE.shortName);
    setMeta('name', 'theme-color', SITE.themeColor);

    setLink('canonical', canonical);
    setLink('alternate', canonical, SITE.language);
    setLink('alternate', canonical, 'x-default');

    setMeta('property', 'og:type', 'website');
    setMeta('property', 'og:site_name', SITE.name);
    setMeta('property', 'og:locale', SITE.locale);
    setMeta('property', 'og:title', fullTitle);
    setMeta('property', 'og:description', description);
    setMeta('property', 'og:url', canonical);
    setMeta('property', 'og:image', image);
    setMeta('property', 'og:image:secure_url', image);
    setMeta('property', 'og:image:type', 'image/png');
    setMeta('property', 'og:image:width', '1200');
    setMeta('property', 'og:image:height', '630');
    setMeta('property', 'og:image:alt', OG_IMAGE_ALT);

    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', fullTitle);
    setMeta('name', 'twitter:description', description);
    setMeta('name', 'twitter:image', image);
    setMeta('name', 'twitter:image:alt', OG_IMAGE_ALT);

    setStructuredData(
      buildStructuredData({
        path: routePath,
        title: fullTitle,
        description,
        crumbs,
        faq,
        includeApp,
      }),
    );
  }, [
    fullTitle,
    description,
    canonical,
    robots,
    image,
    includeApp,
    routePath,
    crumbsKey,
    faqKey,
  ]);

  return null;
}
