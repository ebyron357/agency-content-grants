export function embedImagesForExport(
  html: string,
  images: Array<{ id: string; mimeType: string; data: Buffer }>,
): string {
  return images.reduce((result, image) => {
    const dataUrl = `data:${image.mimeType};base64,${image.data.toString("base64")}`;
    return result.replaceAll(`/api/media/images/${image.id}`, dataUrl);
  }, html);
}
