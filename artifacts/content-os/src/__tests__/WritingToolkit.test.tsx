import { describe, expect, it } from 'vitest';
import { isLogicModelSection, letterRequestText, toolkitDone } from '@/components/grants/WritingToolkit';
import type { Workspace } from '@/lib/grants';

const ws = {
  applicant: { name: 'Read & Rise Literacy' },
  opportunity: { agency: 'U.S. Department of Education', title: 'Community Literacy', number: 'ED-1' },
  format: { set: true, over: false, fileNameIssues: [] },
  letters: [],
} as unknown as Workspace;

describe('writing toolkit helpers', () => {
  it('builds a letter request from what the user entered and leaves the rest as placeholders', () => {
    const text = letterRequestText(ws, { name: 'Dr. Lee', organization: 'Durham Public Schools', purpose: 'hosting the sessions', dueOn: '2026-12-01' });
    expect(text).toContain('Dear Dr. Lee,');
    expect(text).toContain('Read & Rise Literacy is applying to U.S. Department of Education for "Community Literacy" (ED-1)');
    expect(text).toContain('on behalf of Durham Public Schools');
    expect(text).toContain('describes: hosting the sessions.');
    expect(text).toContain('by 2026-12-01');
    expect(text).toContain('[Add: your name and title]');
    const bare = letterRequestText(ws, { name: 'Mayor', organization: null, purpose: null, dueOn: null });
    expect(bare).toContain('[Add: what you would like the letter to cover]');
    expect(bare).toContain('[Add: date]');
  });

  it('recognizes logic model sections', () => {
    expect(isLogicModelSection({ key: 'logic_model', title: 'X' } as any)).toBe(true);
    expect(isLogicModelSection({ key: 'custom_1', title: 'Program logic model' } as any)).toBe(true);
    expect(isLogicModelSection({ key: 'need', title: 'Statement of need' } as any)).toBe(false);
  });

  it('marks the format and letters step done only when nothing is outstanding', () => {
    expect(toolkitDone(ws)).toBe(true);
    expect(toolkitDone({ ...ws, format: { ...ws.format!, set: false } })).toBe(false);
    expect(toolkitDone({ ...ws, format: { ...ws.format!, over: true } })).toBe(false);
    expect(toolkitDone({ ...ws, letters: [{ status: 'requested' }] } as unknown as Workspace)).toBe(false);
    expect(toolkitDone({ ...ws, letters: [{ status: 'declined' }] } as unknown as Workspace)).toBe(true);
  });
});
