import { basename, join } from "node:path";
import { resolveMediaPath } from "./mediaStorage";
import { resolveSourcePath } from "./sourceStorage";
import { getExportRoot } from "./readiness";
import { isPathWithinDirectory } from "./pathSafety";

/**
 * Files on durable storage that belong to a project. Deleting the project
 * cascades its database rows, so these paths are collected first and removed
 * afterwards; anything that does not resolve safely inside its storage root
 * is skipped rather than deleted.
 */
export function projectFilePaths(rows: {
  imageKeys: string[];
  sourceKeys: Array<string | null>;
  exportUrls: Array<string | null>;
}): string[] {
  const paths: string[] = [];
  const add = (resolvePath: () => string) => {
    try {
      paths.push(resolvePath());
    } catch {
      // invalid or legacy key outside the storage root: never delete it
    }
  };
  for (const key of rows.imageKeys) add(() => resolveMediaPath(key));
  for (const key of rows.sourceKeys) if (key) add(() => resolveSourcePath(key));
  const exportRoot = getExportRoot();
  for (const url of rows.exportUrls) {
    if (!url?.startsWith("/api/exports/download/")) continue;
    const candidate = join(exportRoot, basename(url));
    if (isPathWithinDirectory(exportRoot, candidate)) paths.push(candidate);
  }
  return paths;
}
