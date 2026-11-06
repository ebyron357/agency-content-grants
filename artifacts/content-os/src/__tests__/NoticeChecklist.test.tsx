import { describe, expect, it } from 'vitest';
import { noticeProgressText, provenanceText } from '@/components/grants/NoticeChecklist';
import type { AiJob, GrantNotice, Requirement } from '@/lib/grants';

const notice = { status: 'reading', pagesRead: 0 } as GrantNotice;
const job = (progress: AiJob['progress'], extra: Partial<AiJob> = {}) => ({ id: 'j', kind: 'grant_notice_checklist', status: 'running', sectionId: null, attempts: 1, lastError: null, progress, ...extra }) as AiJob;

describe('notice checklist helpers', () => {
  it('says where the reading is', () => {
    expect(noticeProgressText(notice, job({ stage: 'downloading' }))).toBe('Downloading the notice from the link…');
    expect(noticeProgressText(notice, job({ stage: 'reading', page: 20, pages: 64 }))).toBe('Reading page 20 of 64…');
    expect(noticeProgressText(notice, job({ stage: 'checklist', chunk: 1, chunks: 2 }))).toBe('Proposing the checklist (part 1 of 2)…');
    expect(noticeProgressText(notice, job(null))).toBe('Reading the pages…');
    expect(noticeProgressText(notice, job(null, { status: 'queued', lastError: 'Provider 529' }))).toMatch(/first attempt failed \(Provider 529\)/);
  });

  it('labels demo rows as pattern matching, never as AI', () => {
    expect(provenanceText({ origin: 'notice', extractedBy: 'demo_rules' } as Requirement)).toBe('Proposed by pattern matching (demo, no AI)');
    expect(provenanceText({ origin: 'notice', extractedBy: 'ai:openai' } as Requirement)).toBe('Proposed by AI (openai)');
    expect(provenanceText({ origin: 'manual' } as Requirement)).toBe('Added by a person');
    expect(provenanceText({ origin: 'template' } as Requirement)).toBe('From the template');
  });
});
