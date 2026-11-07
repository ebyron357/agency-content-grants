import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// Real server and sessions. A workspace owner turns on two-factor in
// Settings, saves recovery codes, signs out, signs back in with a code, ends
// another browser's session, and reads the audit log. axe runs on each screen.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";
const PASSWORD = "Second factors stop stolen passwords 4";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

/** RFC 6238 code for a base32 secret, `offset` steps from now. */
function totp(secret: string, offset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/\s/g, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac("sha1", key).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  return String((((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3]) % 1_000_000).padStart(6, "0");
}

test("an owner turns on two-factor, signs in with a code and reviews sessions and the audit log", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const ownerEmail = `secure-owner-${stamp}@client.example`;

  // The operator creates the workspace through the API.
  const operator = await browser.newContext();
  const api = operator.request;
  expect((await api.post(`${baseURL}/api/auth/login`, { data: { password: ADMIN } })).ok()).toBe(true);
  expect((await api.post(`${baseURL}/api/auth/admin-unlock`, { data: { password: ADMIN } })).ok()).toBe(true);
  const created = await (await api.post(`${baseURL}/api/workspaces`, { data: { name: `Secure ${stamp} (synthetic)`, ownerEmail } })).json();
  await operator.close();

  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(created.invitePath);
  await page.getByLabel("Your name").fill("Rosa Owner");
  await page.getByLabel("Choose a password").fill(PASSWORD);
  await page.getByRole("button", { name: /^Join/ }).click();
  await expect(page.getByRole("heading", { name: "Grant Studio", level: 1 })).toBeVisible();

  // Turn on two-factor.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  await expectNoSeriousViolations(page, "two-factor setup");
  const secret = (await page.getByLabel("Setup key").textContent())!.trim();
  await page.getByLabel("Enter the 6-digit code it shows").fill(totp(secret));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  const codes = page.getByRole("list", { name: "Recovery codes" });
  await expect(codes.getByRole("listitem")).toHaveCount(10);
  await expectNoSeriousViolations(page, "recovery codes");
  await expect(page.getByRole("button", { name: "I have saved them" })).toBeDisabled();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("grantcrest-recovery-codes.txt");
  await page.getByRole("button", { name: "I have saved them" }).click();
  await expect(page.getByText(/On since .* 10 recovery codes left/)).toBeVisible();

  // A second browser signs in; the first ends it.
  const other = await (await browser.newContext()).newPage();
  await other.goto("/");
  await other.getByLabel("Email").fill(ownerEmail);
  await other.getByLabel("Password").fill(PASSWORD);
  await other.getByRole("button", { name: "Sign in" }).click();
  await expect(other.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await expectNoSeriousViolations(other, "two-factor sign-in");
  await other.getByLabel("Authentication code").fill("000000");
  await other.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(other.getByRole("alert")).toContainText("not correct");
  await other.getByLabel("Authentication code").fill(totp(secret, 1));
  await other.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(other.getByRole("main")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Where you're signed in" })).toBeVisible();
  await expect(page.getByText("This browser")).toBeVisible();
  await page.getByRole("button", { name: "Sign out everywhere else" }).click();
  await expect(page.getByText("Signed out everywhere else.")).toBeVisible();
  await other.reload();
  await expect(other.getByRole("button", { name: "Sign in" })).toBeVisible();

  // The audit log shows the security events, and filters by category.
  await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  await page.getByLabel("Category").selectOption("access");
  await expect(page.getByText("Rosa Owner turned on two-factor sign-in")).toBeVisible();
  await expect(page.getByText(/Rosa Owner signed out 1 other browser/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", /audit\.csv\?category=access/);
  await expectNoSeriousViolations(page, "team tab with security panels");

  // Phone width: no horizontal scroll.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Two-factor sign-in" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await context.close();
});
