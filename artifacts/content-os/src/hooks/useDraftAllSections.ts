/**
 * useDraftAllSections — Phase 2 of the Hybrid orchestration (audit §3b).
 *
 * Sequentially calls POST /api/document-sections/:id/draft for each pending
 * section. Each section is independent: if one fails, completed sections are
 * preserved and the loop continues to the next (errors are non-fatal unless
 * all sections fail).
 *
 * Resumable: if the hook is started with a mix of pending/drafted sections,
 * it skips already-drafted ones and only drafts the pending ones.
 *
 * Duplicate-run prevention: `isRunning` is true while the loop is active;
 * calling `start()` while already running is a no-op.
 */

import { useState, useCallback, useRef } from "react";
import { apiPost } from "@/lib/api";

export interface SectionProgress {
  sectionId: string;
  title: string;
  status: "waiting" | "drafting" | "done" | "error";
  error?: string;
}

export interface UseDraftAllSectionsOptions {
  /** Called each time a section is successfully drafted. */
  onSectionComplete?: (sectionId: string) => void;
  /** Called when the loop finishes (all sections attempted). */
  onAllComplete?: () => void;
}

export interface UseDraftAllSectionsReturn {
  /** Start drafting all pending sections. No-op if already running. */
  start: (sections: Array<{ id: string; title: string; status?: string | null }>) => Promise<void>;
  /** Abort the current loop after the in-flight section completes. */
  stop: () => void;
  isRunning: boolean;
  progress: SectionProgress[];
  completedCount: number;
  errorCount: number;
  totalCount: number;
  /** Index (0-based) of the section currently being drafted. */
  currentIndex: number;
}

export function useDraftAllSections(
  options?: UseDraftAllSectionsOptions
): UseDraftAllSectionsReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState<SectionProgress[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const abortRef = useRef(false);
  const runningRef = useRef(false);

  const start = useCallback(
    async (
      sections: Array<{ id: string; title: string; status?: string | null }>
    ) => {
      // Duplicate-run prevention
      if (runningRef.current) return;

      // Only draft pending (or not yet drafted) sections — skip already drafted
      const pending = sections.filter(
        (s) => !s.status || s.status === "pending"
      );
      if (pending.length === 0) {
        options?.onAllComplete?.();
        return;
      }

      abortRef.current = false;
      runningRef.current = true;
      setIsRunning(true);
      setCurrentIndex(0);
      setProgress(
        pending.map((s) => ({
          sectionId: s.id,
          title: s.title,
          status: "waiting",
        }))
      );

      for (let i = 0; i < pending.length; i++) {
        if (abortRef.current) break;

        const section = pending[i];

        setCurrentIndex(i);
        setProgress((prev) =>
          prev.map((p, idx) =>
            idx === i ? { ...p, status: "drafting" } : p
          )
        );

        try {
          await apiPost(`/document-sections/${section.id}/draft`);
          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: "done" } : p
            )
          );
          options?.onSectionComplete?.(section.id);
        } catch (err) {
          const error =
            err instanceof Error ? err.message : "Drafting failed";
          setProgress((prev) =>
            prev.map((p, idx) =>
              idx === i ? { ...p, status: "error", error } : p
            )
          );
          // Non-fatal: continue drafting remaining sections
        }
      }

      runningRef.current = false;
      setIsRunning(false);
      options?.onAllComplete?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.onSectionComplete, options?.onAllComplete]
  );

  const stop = useCallback(() => {
    abortRef.current = true;
    runningRef.current = false;
    setIsRunning(false);
  }, []);

  const completedCount = progress.filter((p) => p.status === "done").length;
  const errorCount = progress.filter((p) => p.status === "error").length;
  const totalCount = progress.length;

  return {
    start,
    stop,
    isRunning,
    progress,
    currentIndex,
    completedCount,
    errorCount,
    totalCount,
  };
}
