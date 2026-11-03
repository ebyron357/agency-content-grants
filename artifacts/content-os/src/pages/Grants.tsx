import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import {
  PageHeader,
  PageShell,
  Panel,
  StateMessage,
} from "@/components/layout/Page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  filterGrantResources,
  grantResources,
  needsSourceReview,
} from "@/data/grants";

const kinds = [...new Set(grantResources.map((item) => item.kind))];
const regions = [
  ...new Set(grantResources.flatMap((item) => item.regions)),
].sort();
const statuses = [...new Set(grantResources.map((item) => item.status))];
const emptyFilters = { query: "", kind: "", region: "", status: "" };

function Filter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm text-foreground"
      >
        <option value="">All {label.toLowerCase()}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function Grants() {
  const [filters, setFilters] = useState(emptyFilters);
  const results = useMemo(
    () => filterGrantResources(grantResources, filters),
    [filters],
  );
  const update = (key: keyof typeof filters, value: string) =>
    setFilters((previous) => ({ ...previous, [key]: value }));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Funding resources"
        title="Grants"
        description="Find funding sources, understand what they cover, and check the official requirements before applying."
      />
      <StateMessage
        title="Start with funding type and location"
        description="Cash grants, advertising credits, software and fundraising platforms provide different kinds of support. These are curated leads, not eligibility approvals or guaranteed awards. Location filters describe program coverage; they do not confirm that you qualify."
      />
      <Panel className="mb-6 p-5">
        <div className="grid gap-4 lg:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-2 text-sm font-medium">
            Search grants
            <span className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"
              />
              <Input
                type="search"
                value={filters.query}
                onChange={(event) => update("query", event.target.value)}
                placeholder="Name, mission or expense"
                className="pl-9"
              />
            </span>
          </label>
          <Filter
            label="Funding types"
            value={filters.kind}
            options={kinds}
            onChange={(value) => update("kind", value)}
          />
          <Filter
            label="Locations"
            value={filters.region}
            options={regions}
            onChange={(value) => update("region", value)}
          />
          <Filter
            label="Statuses"
            value={filters.status}
            options={statuses}
            onChange={(value) => update("status", value)}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p
            role="status"
            aria-live="polite"
            className="text-sm text-muted-foreground"
          >
            {results.length} of {grantResources.length} resources
          </p>
          <Button variant="outline" onClick={() => setFilters(emptyFilters)}>
            Clear filters
          </Button>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Sources checked November 2, 2026. This directory is manually
          maintained. Listings older than 30 days or past a dated deadline are
          marked for review; always confirm the current call.
        </p>
      </Panel>

      {results.length === 0 && (
        <StateMessage
          title="No matching resources"
          description="Try a broader search or remove a filter."
          action={
            <Button onClick={() => setFilters(emptyFilters)}>
              Show all resources
            </Button>
          }
        />
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {results.map((item) => {
          const review = needsSourceReview(item);
          return (
            <Panel key={item.id} as="div" className="p-5 sm:p-6">
              <article
                aria-labelledby={`grant-${item.id}`}
                className="flex h-full flex-col"
              >
                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-lg border border-border bg-muted px-2 py-1">
                    {item.kind}
                  </span>
                  <span className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2 py-1 text-amber-300">
                    {item.status}
                  </span>
                </div>
                <h2
                  id={`grant-${item.id}`}
                  className="text-xl font-semibold tracking-tight"
                >
                  {item.name}
                </h2>
                <p className="mt-2 text-lg font-semibold text-brand">
                  {item.amount}
                </p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {item.summary}
                </p>
                <dl className="my-5 space-y-4 text-sm leading-6">
                  {[
                    ["Where", item.regions.join(" · ")],
                    ["Who can apply", item.eligibility],
                    ["What it supports", item.uses],
                    ["Limits", item.restrictions],
                    ["Timing", item.cycle],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="font-semibold">{label}</dt>
                      <dd className="text-muted-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
                {review && (
                  <p className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm leading-6 text-amber-300">
                    This source check is out of date or its listed deadline has
                    passed. Recheck availability on the official website.
                  </p>
                )}
                <div className="mt-auto border-t border-border pt-4">
                  <p className="mb-2 text-xs text-muted-foreground">
                    Source check:{" "}
                    <time dateTime={item.checkedOn}>{item.checkedOn}</time> ·{" "}
                    {item.topics.join(" · ")}
                  </p>
                  <ul className="space-y-2">
                    {item.sources.map((source) => (
                      <li key={source.url}>
                        <a
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-2 rounded text-sm text-brand underline underline-offset-4"
                        >
                          <span>{source.label}</span>
                          <ExternalLink
                            aria-hidden="true"
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <span className="sr-only"> (opens in new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </article>
            </Panel>
          );
        })}
      </div>
      <Panel className="mt-8 p-5 sm:p-6">
        <h2 className="text-xl font-semibold">Prepare before you apply</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Requirements vary by funder. Gather the documents that apply to your
          organization:
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
          <li>
            Legal name, registration or fiscal sponsor details, and tax status.
          </li>
          <li>
            Mission, service location, population served, and measurable
            results.
          </li>
          <li>
            Project plan, requested amount, itemized budget, and timeline.
          </li>
          <li>
            Leadership information and the financial records requested by the
            funder.
          </li>
          <li>
            Official application instructions, deadline timezone, restrictions,
            and reporting obligations.
          </li>
        </ul>
      </Panel>
    </PageShell>
  );
}
