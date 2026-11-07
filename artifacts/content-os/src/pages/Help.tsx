import { useMemo } from 'react';
import { PageHeader, PageShell, Panel } from '@/components/layout/Page';
import { GrantsGovNotice } from '@/components/layout/Brand';
import { parseGuide, renderInline, type GuideBlock } from '@/lib/guideMarkdown';
import guideSource from '../../../../docs/USER_GUIDE.md?raw';

/**
 * Help: the user guide (docs/USER_GUIDE.md) rendered in the app, so the
 * repository file and this page never drift apart.
 */
export default function Help() {
  const blocks = useMemo(() => parseGuide(guideSource), []);
  // The guide's own title and intro become the page header.
  const titleIndex = blocks.findIndex((b) => b.type === 'heading' && b.level === 1);
  const intro = blocks[titleIndex + 1]?.type === 'paragraph' ? (blocks[titleIndex + 1] as Extract<GuideBlock, { type: 'paragraph' }>) : null;
  const body = blocks.slice(titleIndex + 1 + (intro ? 1 : 0));
  const contents = body.filter((b): b is Extract<GuideBlock, { type: 'heading' }> => b.type === 'heading' && b.level === 2);

  return (
    <PageShell width="default">
      <PageHeader
        eyebrow="Help"
        title="User guide"
        description={intro ? renderInline(intro.text) : 'How to use GrantCrest, task by task.'}
      />
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Guide contents" className="lg:sticky lg:top-6 lg:self-start">
          <Panel className="p-4">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Contents</h2>
            <ol className="space-y-1.5 text-sm">
              {contents.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{h.text}</a>
                </li>
              ))}
            </ol>
          </Panel>
        </nav>
        <article className="min-w-0 space-y-4 text-sm leading-7 text-muted-foreground">
          {body.map((block, index) => <GuideBlockView key={index} block={block} />)}
          <GrantsGovNotice className="border-t border-border pt-4" />
        </article>
      </div>
    </PageShell>
  );
}

function GuideBlockView({ block }: { block: GuideBlock }) {
  switch (block.type) {
    case 'heading':
      if (block.level <= 2) return <h2 id={block.id} className="scroll-mt-6 pt-6 text-xl font-semibold tracking-tight text-foreground first:pt-0">{block.text}</h2>;
      return <h3 id={block.id} className="scroll-mt-6 pt-2 text-base font-semibold text-foreground">{block.text}</h3>;
    case 'paragraph':
      return <p>{renderInline(block.text)}</p>;
    case 'quote':
      return <p className="rounded-xl border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-amber-300">{renderInline(block.text)}</p>;
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={block.ordered ? 'list-decimal space-y-1.5 pl-6' : 'list-disc space-y-1.5 pl-6'}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </Tag>
      );
    }
    case 'table':
      return (
        <div className="overflow-x-auto rounded-xl border border-border" tabIndex={0} role="region" aria-label={`Table: ${block.header.join(', ')}`}>
          <table className="w-full text-left text-sm">
            <thead className="bg-card text-foreground">
              <tr>{block.header.map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-semibold">{renderInline(h)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-border">
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((c, i) => <td key={i} className="px-3 py-2 align-top">{renderInline(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
