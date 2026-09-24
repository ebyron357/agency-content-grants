export function parsePersistedVideoSrc(element: HTMLElement): string | null {
  return element.querySelector("iframe")?.getAttribute("src") ?? null;
}

export function parsePersistedVideoCaption(element: HTMLElement): string {
  return element.querySelector("[data-video-caption]")?.textContent ?? "";
}

export function hasRequiredAltText(value: string): boolean {
  return value.trim().length > 0;
}
