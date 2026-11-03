/**
 * Central SEO configuration.
 *
 * The app is mounted at https://a2a-platform.com/tool/music/ in production.
 * The canonical host is also hardcoded in index.html, public/robots.txt and
 * public/sitemap.xml; change all four together if the deployment moves.
 */

export const SITE_URL = 'https://a2a-platform.com/tool/music/';

export const SITE = {
  name: '渡口 Dukou',
  shortName: '渡口',
  latinName: 'Dukou',
  language: 'zh-CN',
  locale: 'zh_CN',
  title: '渡口 Dukou · QQ 音乐 / 网易云音乐 / Apple Music 歌单迁移',
  description:
    '渡口把 QQ 音乐、网易云音乐、Apple Music 的公开歌单迁移到另一个平台：粘贴链接，自动匹配曲目，扫码授权后一键写进你的账号。支持大歌单、分段导入，登录态加密保存，可随时断开。',
  themeColor: '#f5f4ed',
} as const;

export const OG_IMAGE_URL = `${SITE_URL}og-image.png`;
export const OG_IMAGE_ALT = '渡口 Dukou — 把歌单，渡到对岸';
export const ICON_URL = `${SITE_URL}icon-512.png`;

export const ROBOTS_INDEX =
  'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';
export const ROBOTS_NOINDEX = 'noindex, follow';

export type Crumb = { name: string; path: string };
export type FaqEntry = { question: string; answer: string };

export function absoluteUrl(path = '/'): string {
  const relative = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return relative ? `${SITE_URL}${relative}` : SITE_URL;
}

export function pageTitle(title?: string): string {
  return title ? `${title} · ${SITE.name}` : SITE.title;
}

/** Keep long playlist names from flooding the SERP title. */
export function compactTitle(value: string, max = 40): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

/**
 * The FAQ is rendered on the landing page AND emitted as FAQPage structured
 * data, so the two must stay in the same order with the same wording.
 */
export const HOME_FAQ: FaqEntry[] = [
  {
    question: '能把网易云音乐的歌单迁移到 QQ 音乐吗？',
    answer:
      '可以。粘贴网易云音乐的公开歌单链接，渡口会读取曲名、歌手、专辑和顺序，匹配后在你的 QQ 音乐账号里新建一张歌单。反向从 QQ 音乐迁移到网易云音乐也支持。',
  },
  {
    question: '可以把歌单迁移到 Apple Music 吗？',
    answer:
      '可以。没有配置 Apple 开发者 token 时，渡口通过 Soundiiz 免费生成导入链接，超过 200 首会自动分段；配置开发者 token 后，可以在站内用 MusicKit 授权并直接写入资料库。也可以下载 TXT 曲目表，用 TuneMyMusic 手动导入。',
  },
  {
    question: '迁移会改动我原来的歌单吗？',
    answer:
      '不会。渡口只读取公开歌单的内容，然后在目标平台新建一张歌单；源平台的歌单不会被修改、移动或删除。',
  },
  {
    question: '需要安装 App 或浏览器插件吗？',
    answer:
      '不需要。渡口是浏览器里打开的网页工具。写入 QQ 音乐或网易云音乐时，用手机 App 扫码授权一次即可；登录态用 AES-256-GCM 加密保存，也可以在迁移面板里随时断开。',
  },
  {
    question: '大歌单也能迁移吗？',
    answer:
      '可以。QQ 音乐和网易云音乐按每页 1000 首读取，网易云单张歌单上限 10,000 首；Apple Music 免费导入超过 200 首会自动拆成多段链接，逐段打开即可。',
  },
  {
    question: '支持哪些平台之间的迁移？',
    answer:
      '来源支持 QQ 音乐、网易云音乐和 Apple Music 公开歌单；目标支持 QQ 音乐、网易云音乐和 Apple Music，共三个平台。',
  },
];

export type SeoGraphInput = {
  path?: string;
  title: string;
  description: string;
  crumbs?: Crumb[];
  faq?: FaqEntry[];
  includeApp?: boolean;
};

type JsonLd = Record<string, unknown>;

/**
 * Builds one @graph for a page: Organization + WebSite are always present,
 * WebApplication only on the landing page, plus WebPage / BreadcrumbList /
 * FAQPage for the current route.
 */
export function buildStructuredData({
  path = '/',
  title,
  description,
  crumbs,
  faq,
  includeApp = false,
}: SeoGraphInput): JsonLd {
  const url = absoluteUrl(path);
  const organizationId = `${SITE_URL}#organization`;
  const websiteId = `${SITE_URL}#website`;
  const applicationId = `${SITE_URL}#webapplication`;

  const organization: JsonLd = {
    '@type': 'Organization',
    '@id': organizationId,
    name: SITE.name,
    alternateName: SITE.shortName,
    url: SITE_URL,
    logo: {
      '@type': 'ImageObject',
      url: ICON_URL,
      width: 512,
      height: 512,
    },
  };

  const website: JsonLd = {
    '@type': 'WebSite',
    '@id': websiteId,
    url: SITE_URL,
    name: SITE.name,
    alternateName: SITE.latinName,
    description: SITE.description,
    inLanguage: SITE.language,
    publisher: { '@id': organizationId },
  };

  const webpage: JsonLd = {
    '@type': 'WebPage',
    '@id': `${url}#webpage`,
    url,
    name: title,
    description,
    inLanguage: SITE.language,
    isPartOf: { '@id': websiteId },
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: OG_IMAGE_URL,
    },
  };

  const graph: JsonLd[] = [organization, website, webpage];

  if (includeApp) {
    webpage.about = { '@id': applicationId };
    graph.push({
      '@type': 'WebApplication',
      '@id': applicationId,
      name: SITE.name,
      alternateName: SITE.latinName,
      url: SITE_URL,
      description: SITE.description,
      applicationCategory: 'MultimediaApplication',
      applicationSubCategory: '歌单迁移工具',
      operatingSystem: 'Web',
      browserRequirements: '需要支持 ES2022 的现代浏览器',
      inLanguage: SITE.language,
      isAccessibleForFree: true,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'CNY',
      },
      featureList: [
        'QQ 音乐、网易云音乐歌单互相迁移',
        '通过 Soundiiz 免费导入 Apple Music',
        'Apple Music MusicKit 站内直写',
        '自动匹配曲名、歌手与时长',
        '支持按页读取的大歌单',
        '扫码授权，登录态加密保存',
      ],
      screenshot: OG_IMAGE_URL,
      publisher: { '@id': organizationId },
    });
  }

  if (crumbs && crumbs.length > 1) {
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: crumbs.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.name,
        item: absoluteUrl(crumb.path),
      })),
    });
  }

  if (faq && faq.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: faq.map((entry) => ({
        '@type': 'Question',
        name: entry.question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: entry.answer,
        },
      })),
    });
  }

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
}
