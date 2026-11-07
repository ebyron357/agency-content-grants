import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { db, foundationFundersTable } from "@workspace/db";
import { readApplicationPolicy, type PolicyReading } from "./applicationPolicy";
import type { FetchLike } from "./source";

/**
 * Fills each funder's "accepts applications" flag from its latest filing's
 * Form 990-PF e-file XML (docs/GRANT_STUDIO.md, Foundations).
 *
 * funder-graph's grant rows do not carry Part XIV line 2, so this reads the
 * XML itself. The IRS publishes e-file XML only in zip batches
 * (https://www.irs.gov/charities-non-profits/form-990-series-downloads), one
 * file per filing named `{object id}_public.xml`; an operator extracts the
 * batches they need into a directory (or serves them over https) and sets
 * FOUNDATIONS_XML_BASE_URL. The step runs inside the foundation import, which
 * stays off until the owner sets FOUNDATIONS_IMPORT_ENABLED=true.
 *
 * Stored per funder: the policy, the object id, tax year and period of the
 * filing it came from, and at most 900 characters of line 2b–2d text. A
 * missing file leaves the funder "unknown"; nothing is guessed.
 */

export interface PolicyImportConfig {
  /** A local directory or an https URL holding `{objectId}_public.xml` files. */
  xmlBase: string;
  /** Funders read per run, newest unread first. */
  maxPerRun: number;
}

export function policyConfigFromEnv(): PolicyImportConfig | null {
  const xmlBase = process.env.FOUNDATIONS_XML_BASE_URL?.trim();
  if (!xmlBase) return null;
  const n = Number(process.env.FOUNDATIONS_XML_MAX_PER_RUN);
  return { xmlBase, maxPerRun: Number.isFinite(n) && n >= 1 && n <= 200_000 ? Math.trunc(n) : 5_000 };
}

const isRemote = (base: string) => /^https?:\/\//i.test(base);
const OBJECT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Reads one filing's XML, or null when it is not there. Object ids are checked, so a path never leaves the base. */
export async function readFilingXml(base: string, objectId: string, fetchImpl?: FetchLike): Promise<string | null> {
  if (!OBJECT_ID.test(objectId)) return null;
  if (isRemote(base)) {
    const res = await (fetchImpl ?? (globalThis.fetch as FetchLike))(`${base.replace(/\/+$/, "")}/${objectId}_public.xml`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`XML for ${objectId} answered ${res.status}`);
    return res.text();
  }
  const dir = base.startsWith("file:") ? fileURLToPath(base) : base;
  for (const name of [`${objectId}_public.xml`, `${objectId}.xml`]) {
    try {
      return await readFile(join(dir, name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return null;
}

export interface PolicyImportStats {
  xml_checked: number;
  xml_missing: number;
  xml_ein_mismatch: number;
  xml_errors: number;
  invitation_only: number;
  accepts_applications: number;
  unknown: number;
}

export function emptyPolicyStats(): PolicyImportStats {
  return { xml_checked: 0, xml_missing: 0, xml_ein_mismatch: 0, xml_errors: 0, invitation_only: 0, accepts_applications: 0, unknown: 0 };
}

/** Values stored for one reading. Exported for tests. */
export function policyColumns(reading: PolicyReading, objectId: string) {
  return {
    applicationPolicy: reading.policy === "unknown" ? null : reading.policy,
    applicationPolicyObjectId: objectId,
    applicationPolicyTaxYear: reading.taxYear,
    applicationPolicyTaxPeriodEnd: reading.taxPeriodEnd,
    applicationInfo: reading.info as Record<string, string>,
    applicationPolicyCheckedAt: new Date(),
  };
}

/**
 * Reads the latest filing of each 990-PF funder whose flag has not been read
 * from that filing yet. A funder already read from its latest filing is
 * skipped, so a repeated run reads nothing twice.
 */
export async function runPolicyImport(cfg: PolicyImportConfig, opts: { fetchImpl?: FetchLike; signal?: AbortSignal; onProgress?: (p: Record<string, unknown>) => Promise<void> | void } = {}): Promise<PolicyImportStats> {
  const stats = emptyPolicyStats();
  const due = await db
    .select({ ein: foundationFundersTable.ein, latestObjectId: foundationFundersTable.latestObjectId })
    .from(foundationFundersTable)
    .where(
      and(
        eq(foundationFundersTable.formType, "990PF"),
        isNotNull(foundationFundersTable.latestObjectId),
        or(isNull(foundationFundersTable.applicationPolicyObjectId), ne(foundationFundersTable.applicationPolicyObjectId, sql`${foundationFundersTable.latestObjectId}`)),
      ),
    )
    .orderBy(asc(foundationFundersTable.ein))
    .limit(cfg.maxPerRun);
  for (const f of due) {
    opts.signal?.throwIfAborted();
    const objectId = f.latestObjectId!;
    let xml: string | null;
    try {
      xml = await readFilingXml(cfg.xmlBase, objectId, opts.fetchImpl);
    } catch {
      stats.xml_errors += 1;
      continue;
    }
    if (xml === null) {
      stats.xml_missing += 1;
      continue;
    }
    stats.xml_checked += 1;
    const reading = readApplicationPolicy(xml);
    // The document must be this funder's own return.
    if (reading.ein && reading.ein !== f.ein) {
      stats.xml_ein_mismatch += 1;
      continue;
    }
    stats[reading.policy] += 1;
    await db.update(foundationFundersTable).set(policyColumns(reading, objectId)).where(eq(foundationFundersTable.ein, f.ein));
    if (stats.xml_checked % 200 === 0) await opts.onProgress?.({ stage: "application_policy", ...stats });
  }
  return stats;
}
