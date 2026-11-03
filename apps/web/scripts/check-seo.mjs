#!/usr/bin/env node
/**
 * Verifies the built SPA shell still carries the SEO contract:
 * static head tags, JSON-LD graph, no-JS fallback and public SEO files.
 *
 * Runs at the end of `pnpm --filter @dukou/web build`, so a broken tag or a
 * missing sitemap fails the Docker image build instead of shipping silently.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(webRoot, 'dist');
const failures = [];
let checks = 0;

function check(label, fn) {
  checks += 1;
  try {
    const detail = fn();
    console.log(`  ok  ${label}${detail ? ` (${detail})` : ''}`);
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : error}`);
    console.error(`FAIL  ${label}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  const path = resolve(dist, file);
  assert(existsSync(path), `${file} is missing from dist`);
  return readFileSync(path, 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findTag(html, tag, attr, value) {
  const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, 'gi')) ?? [];
  const pattern = new RegExp(`\\b${attr}=["']${escapeRegExp(value)}["']`, 'i');
  return tags.find((entry) => pattern.test(entry));
}

function tagAttr(tag, attr) {
  const match = tag?.match(new RegExp(`\\b${attr}=["']([^"']*)["']`, 'i'));
  return match?.[1] ?? '';
}

function getMeta(html, key) {
  const tag =
    findTag(html, 'meta', 'name', key) ?? findTag(html, 'meta', 'property', key);
  assert(tag, `meta ${key} missing`);
  const content = tagAttr(tag, 'content');
  assert(content, `meta ${key} has no content`);
  return content;
}

const html = read('index.html');
const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
const title = titleMatch?.[1]?.trim() ?? '';

// The canonical host lives in src/lib/seo.ts. Reading it here keeps the
// build check meaningful when the deployment moves to another domain.
const seoSource = readFileSync(resolve(webRoot, 'src/lib/seo.ts'), 'utf8');
const siteUrl = seoSource.match(/export const SITE_URL = '([^']+)'/)?.[1];
assert(siteUrl, 'SITE_URL not found in src/lib/seo.ts');
const sitePath = new URL(siteUrl).pathname;

check('html language is zh-CN', () => {
  assert(/<html[^>]*\blang=["']zh-CN["']/i.test(html), 'missing <html lang="zh-CN">');
  return 'zh-CN';
});

check('title is present and descriptive', () => {
  assert(title.length >= 12 && title.length <= 70, `title length ${title.length}`);
  assert(/渡口/.test(title), 'title does not mention 渡口');
  return `${title.length} chars`;
});

check('description is present', () => {
  const value = getMeta(html, 'description');
  assert(value.length >= 50 && value.length <= 200, `description length ${value.length}`);
  return `${value.length} chars`;
});

check('robots allows indexing', () => {
  const value = getMeta(html, 'robots');
  assert(/index/.test(value) && !/noindex/.test(value), value);
  return value;
});

check('canonical points at the public route', () => {
  const tag = findTag(html, 'link', 'rel', 'canonical');
  assert(tag, 'canonical link missing');
  const href = tagAttr(tag, 'href');
  assert(href === siteUrl, `${href} does not match SITE_URL ${siteUrl}`);
  return href;
});

check('hreflang alternates are present', () => {
  const zh = findTag(html, 'link', 'hreflang', 'zh-CN');
  const fallback = findTag(html, 'link', 'hreflang', 'x-default');
  assert(zh && fallback, 'zh-CN / x-default alternates missing');
  assert(tagAttr(zh, 'href') === siteUrl, 'zh-CN href mismatch');
  assert(tagAttr(fallback, 'href') === siteUrl, 'x-default href mismatch');
  return 'zh-CN, x-default';
});

check('Open Graph tags are complete', () => {
  const required = [
    'og:type',
    'og:site_name',
    'og:locale',
    'og:title',
    'og:description',
    'og:url',
    'og:image',
    'og:image:secure_url',
    'og:image:width',
    'og:image:height',
    'og:image:alt',
  ];
  for (const key of required) getMeta(html, key);
  assert(getMeta(html, 'og:url') === siteUrl, 'og:url mismatch');
  assert(getMeta(html, 'og:image') === `${siteUrl}og-image.png`, 'og:image mismatch');
  assert(getMeta(html, 'og:image:width') === '1200', 'og:image:width should be 1200');
  assert(getMeta(html, 'og:image:height') === '630', 'og:image:height should be 630');
  return `${required.length} tags`;
});

check('Twitter card tags are complete', () => {
  for (const key of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) {
    getMeta(html, key);
  }
  assert(getMeta(html, 'twitter:card') === 'summary_large_image', 'unexpected card type');
  return 'summary_large_image';
});

check('structured data parses and covers the key entities', () => {
  const match = html.match(
    /<script[^>]*id=["']seo-structured-data["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert(match, 'seo-structured-data script missing');
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`invalid JSON-LD: ${error.message}`);
  }
  assert(data['@context'] === 'https://schema.org', 'wrong @context');
  const types = (data['@graph'] ?? []).map((node) => node['@type']);
  for (const type of ['Organization', 'WebSite', 'WebPage', 'WebApplication', 'FAQPage']) {
    assert(types.includes(type), `missing ${type}`);
  }
  const organization = data['@graph'].find((node) => node['@type'] === 'Organization');
  assert(organization.url === siteUrl, 'Organization url mismatch');
  const website = data['@graph'].find((node) => node['@type'] === 'WebSite');
  assert(website.url === siteUrl, 'WebSite url mismatch');
  const faq = data['@graph'].find((node) => node['@type'] === 'FAQPage');
  assert(faq.mainEntity.length >= 5, `only ${faq.mainEntity.length} FAQ entries`);
  assert(
    faq.mainEntity.every((entry) => entry.name && entry.acceptedAnswer?.text),
    'FAQ entry with empty question or answer',
  );
  return `${types.length} entities, ${faq.mainEntity.length} FAQs`;
});

check('no-JS fallback contains readable content', () => {
  const match = html.match(/<noscript>([\s\S]*?)<\/noscript>/gi) ?? [];
  assert(match.length >= 1, '<noscript> fallback missing');
  const body = match.join('\n');
  assert(/<h1>[^<]*把歌单/.test(body), 'fallback h1 missing');
  assert(/QQ 音乐/.test(body) && /Apple Music/.test(body), 'fallback platform copy missing');
  assert(/href=["']\.\/login["']/.test(body), 'fallback login link missing');
  return `${match.length} noscript blocks`;
});

check('file icons and manifest are linked', () => {
  for (const [rel, type] of [
    ['icon', 'image/svg+xml'],
    ['apple-touch-icon', ''],
    ['manifest', ''],
  ]) {
    assert(findTag(html, 'link', 'rel', rel), `${rel} link missing`);
    if (type) assert(tagAttr(findTag(html, 'link', 'rel', rel), 'type') === type, `${rel} type`);
  }
  return 'favicon, touch icon, manifest';
});

check('robots.txt is served and points at the sitemap', () => {
  const content = read('robots.txt');
  assert(/^User-agent: \*/m.test(content), 'no User-agent rule');
  assert(
    content.includes(`Sitemap: ${siteUrl}sitemap.xml`),
    'sitemap reference missing',
  );
  assert(
    content.includes(`Disallow: ${sitePath}app`),
    'private app routes not disallowed',
  );
  return 'ok';
});

check('sitemap.xml is valid and lists the landing page', () => {
  const content = read('sitemap.xml');
  assert(content.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'missing XML declaration');
  assert(content.includes(`<loc>${siteUrl}</loc>`), 'landing URL missing');
  assert(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(content), 'lastmod missing');
  return '1 URL';
});

check('web app manifest parses with installable icons', () => {
  const manifest = JSON.parse(read('site.webmanifest'));
  assert(manifest.name && manifest.short_name, 'name / short_name missing');
  assert(manifest.start_url && manifest.scope, 'start_url / scope missing');
  assert(manifest.theme_color === '#f5f4ed', 'theme color mismatch');
  assert(Array.isArray(manifest.icons) && manifest.icons.length >= 2, 'icons missing');
  for (const icon of manifest.icons) {
    assert(existsSync(resolve(dist, icon.src)), `icon ${icon.src} missing`);
  }
  return `${manifest.icons.length} icons`;
});

check('social image is a 1200x630 PNG', () => {
  const path = resolve(dist, 'og-image.png');
  assert(existsSync(path), 'og-image.png missing');
  const buffer = readFileSync(path);
  assert(buffer.subarray(1, 4).toString('ascii') === 'PNG', 'not a PNG');
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  assert(width === 1200 && height === 630, `got ${width}x${height}`);
  return `${Math.round(statSync(path).size / 1024)} KB`;
});

console.log(`\n[seo] ${checks - failures.length}/${checks} checks passed`);
if (failures.length > 0) {
  console.error('\nSEO check failed:');
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
