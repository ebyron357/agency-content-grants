import { mkdir } from "fs/promises";
import { isAbsolute, join, relative, resolve } from "path";

export function getMediaRoot(): string {
  return resolve(
    process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads", "images"),
  );
}

export function resolveMediaPath(storageKey: string): string {
  const root = getMediaRoot();
  const candidate = resolve(root, storageKey);
  const relativePath = relative(root, candidate);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Invalid media storage key");
  }
  return candidate;
}

export async function ensureMediaRoot(): Promise<void> {
  await mkdir(getMediaRoot(), { recursive: true });
}
