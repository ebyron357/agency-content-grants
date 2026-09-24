import { describe, expect, it } from 'vitest';
import { extensionForImageType, hasImageSignature, isAllowedImageType } from '../lib/imageValidator';

describe('image validator', () => {
  it('allows only safe raster MIME types', () => {
    expect(isAllowedImageType('image/jpeg')).toBe(true);
    expect(isAllowedImageType('image/png')).toBe(true);
    expect(isAllowedImageType('image/gif')).toBe(true);
    expect(isAllowedImageType('image/webp')).toBe(true);
    expect(isAllowedImageType('image/svg+xml')).toBe(false);
  });

  it('recognizes valid raster signatures', () => {
    expect(hasImageSignature(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg')).toBe(true);
    expect(hasImageSignature(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).toBe(true);
    expect(hasImageSignature(new TextEncoder().encode('GIF89a'), 'image/gif')).toBe(true);
    expect(hasImageSignature(new TextEncoder().encode('RIFF0000WEBP'), 'image/webp')).toBe(true);
  });

  it('rejects mismatched, truncated, and active-document content', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(hasImageSignature(png, 'image/jpeg')).toBe(false);
    expect(hasImageSignature(new TextEncoder().encode('<svg onload="alert(1)">'), 'image/svg+xml')).toBe(false);
    expect(hasImageSignature(Uint8Array.from([0x89, 0x50]), 'image/png')).toBe(false);
  });

  it('derives safe storage extensions from the validated MIME', () => {
    expect(extensionForImageType('image/jpeg')).toBe('.jpg');
    expect(extensionForImageType('image/png')).toBe('.png');
    expect(extensionForImageType('image/webp')).toBe('.webp');
    expect(extensionForImageType('image/svg+xml')).toBe('.bin');
  });
});
