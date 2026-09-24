export const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

export function extensionForImageType(contentType: string): string {
  return EXTENSION_BY_TYPE[contentType] ?? '.bin';
}

export function isAllowedImageType(contentType: string): boolean {
  return ALLOWED_IMAGE_TYPES.has(contentType);
}

/**
 * Verify the leading bytes match the claimed safe raster image type.
 * SVG is deliberately excluded because it is an active document format and
 * should not be served from the authenticated media endpoint as an image.
 */
export function hasImageSignature(buffer: Uint8Array, contentType: string): boolean {
  if (!isAllowedImageType(contentType)) return false;
  if (contentType === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return buffer.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => buffer[index] === value);
  }
  if (contentType === 'image/gif') {
    return buffer.length >= 6 && (new TextDecoder().decode(buffer.slice(0, 6)) === 'GIF87a' || new TextDecoder().decode(buffer.slice(0, 6)) === 'GIF89a');
  }
  return buffer.length >= 12 && new TextDecoder().decode(buffer.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(buffer.slice(8, 12)) === 'WEBP';
}
