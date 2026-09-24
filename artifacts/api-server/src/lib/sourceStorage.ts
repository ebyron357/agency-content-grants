import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export function getSourceRoot(): string {
  return resolve(
    process.env.SOURCE_UPLOAD_DIR ?? join(process.cwd(), "uploads", "sources"),
  );
}

export async function storeSourcePdf(buffer: Buffer): Promise<string> {
  const key = `${randomUUID()}.pdf`;
  await mkdir(getSourceRoot(), { recursive: true });
  await writeFile(resolveSourcePath(key), buffer, { flag: "wx" });
  return key;
}

export function resolveSourcePath(key: string): string {
  const root = getSourceRoot();
  const candidate = resolve(root, key);
  const relativePath = relative(root, candidate);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("Invalid source storage key");
  }
  return candidate;
}

export async function readSourcePdf(key: string): Promise<Buffer> {
  return readFile(resolveSourcePath(key));
}

export async function deleteSourcePdf(key: string): Promise<void> {
  await unlink(resolveSourcePath(key));
}
