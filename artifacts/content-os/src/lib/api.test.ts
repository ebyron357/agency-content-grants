import { describe, expect, it } from 'vitest';
import { resolveApiAssetUrl } from './api';

describe('resolveApiAssetUrl', () => {
  it('does not duplicate the API prefix returned by export records', () => {
    expect(resolveApiAssetUrl('/api/exports/download/report.pdf')).toBe(
      '/api/exports/download/report.pdf',
    );
  });

  it('adds the API prefix to an unprefixed asset path', () => {
    expect(resolveApiAssetUrl('/exports/download/report.pdf')).toBe(
      '/api/exports/download/report.pdf',
    );
  });
});
