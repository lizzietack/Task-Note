import { useEffect } from 'react';

const SITE_URL = 'https://www.getjotrelay.com';
const SOCIAL_IMAGE = `${SITE_URL}/jotrelay-social.png`;

const pages = {
  home: {
    title: 'JotRelay — Shared Tasks, Notes & Team Collaboration',
    description: 'Organize tasks and notes, share lists, assign work, exchange comments and attachments, and stay in sync across every device with JotRelay.',
    path: '/',
  },
  privacy: {
    title: 'Privacy Policy | JotRelay',
    description: 'Read how JotRelay handles account details, tasks, notes, attachments, collaboration data and your privacy choices.',
    path: '/privacy',
  },
  terms: {
    title: 'Terms of Service | JotRelay',
    description: 'Read the terms that apply when you create an account and use JotRelay for personal and collaborative task management.',
    path: '/terms',
  },
};

function setMeta(selector, attribute, value) {
  let element = document.head.querySelector(selector);
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attribute[0], attribute[1]);
    document.head.appendChild(element);
  }
  element.setAttribute('content', value);
}

export function applySeoMetadata(kind = '') {
  const page = pages[kind] || pages.home;
  const canonicalUrl = `${SITE_URL}${page.path}`;
  document.title = page.title;
  setMeta('meta[name="description"]', ['name', 'description'], page.description);
  setMeta('meta[property="og:title"]', ['property', 'og:title'], page.title);
  setMeta('meta[property="og:description"]', ['property', 'og:description'], page.description);
  setMeta('meta[property="og:url"]', ['property', 'og:url'], canonicalUrl);
  setMeta('meta[property="og:image"]', ['property', 'og:image'], SOCIAL_IMAGE);
  setMeta('meta[name="twitter:title"]', ['name', 'twitter:title'], page.title);
  setMeta('meta[name="twitter:description"]', ['name', 'twitter:description'], page.description);
  setMeta('meta[name="twitter:image"]', ['name', 'twitter:image'], SOCIAL_IMAGE);
  let canonical = document.head.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', canonicalUrl);
}

export function useSeoMetadata(kind = '') {
  useEffect(() => applySeoMetadata(kind), [kind]);
}
