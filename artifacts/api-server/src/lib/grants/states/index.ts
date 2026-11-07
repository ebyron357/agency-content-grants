import { builtinFetch, userAgent } from "../sources/fetcher";
import type { StatePageFetch, StateRecord } from "./common";
import { IL_CONNECTOR_VERSION, IL_JURISDICTION, IL_LIST_URL, IL_SOURCE, fetchIlRecords } from "./illinois";
import { NC_CONNECTOR_VERSION, NC_DIRECTORY_URL, NC_JURISDICTION, NC_SOURCE, fetchNcRecords } from "./northCarolina";
import { UT_CONNECTOR_VERSION, UT_JURISDICTION, UT_REPORT_URL, UT_SOURCE, fetchUtRecords, type UtRenderer } from "./utah";

/**
 * The state feed connectors that plug into the source registry
 * (docs/SOURCE_REGISTRY.md §7). Each has a `feed` row in `grant_sources`
 * whose connector and key equal `source` here. The daily grant sync runs a
 * state feed only while its row may run: active, with its terms recorded as
 * checked and permitting automated reading. Rows are registered disabled.
 */

export interface StateFeedDeps {
  fetchPage?: StatePageFetch;
  utRender?: UtRenderer | null;
  now?: Date;
}

export interface StateFeed {
  /** The connector name, the registry key and `grant_opportunities.source`. */
  source: string;
  name: string;
  jurisdiction: string;
  version: string;
  url: string;
  read: (deps: StateFeedDeps) => Promise<StateRecord[]>;
}

/** The source watcher's respectful reader: honest User-Agent, one request per host every 10 s, https and public hosts only. */
export const defaultStatePageFetch: StatePageFetch = async (url) => {
  const res = await builtinFetch(url, { userAgent: userAgent() });
  return { status: res.status, body: res.body };
};

export const STATE_FEEDS: readonly StateFeed[] = [
  { source: IL_SOURCE, name: "Illinois CSFA opportunity list", jurisdiction: IL_JURISDICTION, version: IL_CONNECTOR_VERSION, url: IL_LIST_URL, read: (d) => fetchIlRecords(d.fetchPage ?? defaultStatePageFetch, d.now) },
  { source: NC_SOURCE, name: "NC.gov grant opportunities directory", jurisdiction: NC_JURISDICTION, version: NC_CONNECTOR_VERSION, url: NC_DIRECTORY_URL, read: (d) => fetchNcRecords(d.fetchPage ?? defaultStatePageFetch) },
  { source: UT_SOURCE, name: "Utah Funding Opportunities Portal", jurisdiction: UT_JURISDICTION, version: UT_CONNECTOR_VERSION, url: UT_REPORT_URL, read: (d) => fetchUtRecords(d.utRender ?? null) },
];

/** Display names for opportunities from each state feed. */
export const STATE_SOURCE_LABELS: Record<string, string> = Object.fromEntries(STATE_FEEDS.map((f) => [f.source, f.name]));
