import { describe, expect, it } from 'vitest';
import { bootLocaleFromPath } from './services.ts';

describe('bootLocaleFromPath', () => {
  it('boots Arabic on the /ar entry and its subpaths', () => {
    expect(bootLocaleFromPath('/ar')).toBe('ar');
    expect(bootLocaleFromPath('/ar/')).toBe('ar');
    expect(bootLocaleFromPath('/ar/sample')).toBe('ar');
  });

  it('boots English everywhere else, including /-prefixed near-misses', () => {
    expect(bootLocaleFromPath('/')).toBe('en');
    expect(bootLocaleFromPath('/archive')).toBe('en');
    expect(bootLocaleFromPath('/argument')).toBe('en');
  });

  it('honors a prerendered Arabic shell on SPA-fallback hosts', () => {
    // A static host may serve the EN shell at /ar/: documentElement.lang is
    // 'ar' from the prerender, so the document wins over the bare path check.
    expect(bootLocaleFromPath('/ar/', 'ar')).toBe('ar');
    expect(bootLocaleFromPath('/ar', 'ar')).toBe('ar');
  });

  it('never lets a stored preference turn an English route Arabic', () => {
    // Regression: `/` must boot 'en' even when localStorage holds {locale:'ar'}
    // — the stored choice only mirrors the path the toggle navigated to.
    expect(bootLocaleFromPath('/', 'en')).toBe('en');
  });
});
