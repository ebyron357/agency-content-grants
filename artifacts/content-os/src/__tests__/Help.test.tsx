import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseGuide, renderInline, slugify } from '@/lib/guideMarkdown';
import { GRANTS_GOV_NOTICE } from '@/components/layout/Brand';
import Help from '@/pages/Help';

const guide = readFileSync(path.resolve(__dirname, '../../../../docs/USER_GUIDE.md'), 'utf8');

describe('user guide', () => {
  it('parses headings, lists, tables and paragraphs', () => {
    const blocks = parseGuide('# Title\n\nIntro **bold** text.\n\n## Two-factor sign-in\n\n1. One\n2. Two\n\n- a\n- b\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> Note');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list', 'table', 'quote']);
    expect(blocks[2]).toMatchObject({ id: 'two-factor-sign-in', level: 2 });
    expect(blocks[3]).toMatchObject({ ordered: true, items: ['One', 'Two'] });
    expect(blocks[5]).toMatchObject({ header: ['A', 'B'], rows: [['1', '2']] });
    expect(slugify('Format & letters')).toBe('format-letters');
  });

  it('renders only safe links and no raw HTML', () => {
    render(<p>{renderInline('See [site](https://grantcrest.co), [bad](javascript:alert(1)) and <b>x</b>.')}</p>);
    expect(screen.getByRole('link', { name: /site/ })).toHaveAttribute('href', 'https://grantcrest.co');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByText(/<b>x<\/b>/)).toBeInTheDocument();
  });

  it('covers every task a grant writer needs, in plain language', () => {
    const headings = parseGuide(guide).filter((b) => b.type === 'heading').map((b) => (b as { text: string }).text);
    for (const topic of ['Signing in', 'Workspaces and team roles', 'Two-factor sign-in', 'Setting up an organization profile', 'Confirming facts in the fact library', 'Finding grants', 'The notice PDF checklist', 'Drafting with confirmed facts', 'Budgets', 'Approvals', 'Exporting the package', 'Billing and plans', 'Getting help']) {
      expect(headings).toContain(topic);
    }
    expect(guide).not.toMatch(/Content OS|Content Machine/);
  });

  it('renders the guide in the app with its contents and the Grants.gov notice', () => {
    render(<Help />);
    expect(screen.getByRole('heading', { level: 1, name: 'User guide' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Guide contents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'The notice PDF checklist' })).toHaveAttribute('id', 'the-notice-pdf-checklist');
    expect(screen.getByText(GRANTS_GOV_NOTICE)).toBeInTheDocument();
  });
});
