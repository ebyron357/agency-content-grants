import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Real server and sessions. The operator creates a client workspace, its
// first owner accepts the invitation in a separate browser context and
// invites a writer, and the screens pass the accessibility gate.

const ADMIN = process.env.TEST_ADMIN_PASSWORD ?? "test-admin-password-not-for-production";
const PASSWORD = "Correct horse battery staple 42";

async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact ?? ""));
  expect(blocking, `${label}: ${JSON.stringify(blocking, null, 2)}`).toEqual([]);
}

test("operator creates a client workspace and its owner joins and invites a writer", async ({ page, browser }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  const ownerEmail = `owner-${stamp}@client.example`;

  // Operator: team password, unlock admin, create the workspace.
  await page.goto("/");
  await expect(page.getByLabel("Email")).toBeVisible();
  await expectNoSeriousViolations(page, "login");
  await page.getByLabel("Password").fill(ADMIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("main")).toBeVisible();
  await page.goto("/settings");
  await page.getByLabel("Admin password").fill(ADMIN);
  await page.getByRole("button", { name: "Unlock admin access" }).click();
  await expect(page.getByRole("button", { name: /Lock admin access|Lock/ }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Client workspaces" })).toBeVisible();
  await page.getByLabel("Workspace name").fill(`Client ${stamp} (synthetic)`);
  await page.getByLabel("First owner's email").fill(ownerEmail);
  await page.getByRole("button", { name: "Create workspace" }).click();
  const link = await page.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{30,}$/);
  await expectNoSeriousViolations(page, "team tab (operator)");

  // Owner, in a fresh browser: accept, land in the app, see their workspace.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto(link);
  await expect(owner.getByRole("heading", { name: `Join Client ${stamp} (synthetic)` })).toBeVisible();
  await expectNoSeriousViolations(owner, "invitation page");
  await owner.getByLabel("Your name").fill("Olive Owner");
  await owner.getByLabel("Choose a password").fill("short");
  await owner.getByRole("button", { name: /^Join/ }).click();
  await expect(owner.getByRole("alert")).toContainText("12 characters");
  await owner.getByLabel("Choose a password").fill(PASSWORD);
  await owner.getByRole("button", { name: /^Join/ }).click();
  await expect(owner.getByRole("heading", { name: "Grant Studio", level: 1 })).toBeVisible();
  await owner.goto("/settings");
  await expect(owner.getByText(`signed in as Olive Owner (${ownerEmail})`)).toBeVisible();

  // The owner invites a writer and withdraws a second invitation.
  await owner.getByLabel("Email", { exact: true }).fill(`writer-${stamp}@client.example`);
  await owner.getByRole("combobox", { name: /^Role/ }).selectOption("writer");
  await owner.getByRole("button", { name: "Create invitation" }).click();
  await expect(owner.getByLabel("Invitation link")).toHaveValue(/\/invite\//);
  await expect(owner.getByText(`writer-${stamp}@client.example`)).toBeVisible();
  await owner.getByRole("button", { name: `Withdraw the invitation for writer-${stamp}@client.example` }).click();
  await expect(owner.getByText(`writer-${stamp}@client.example`)).toHaveCount(0);
  // The role table comes from the server's permission policy.
  const matrix = owner.getByRole("table", { name: "Permissions held by each role" });
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole("row", { name: /Approve the final package/ })).toBeVisible();
  await expectNoSeriousViolations(owner, "team tab (owner)");

  // Mobile: no horizontal scroll on the invitation and team screens.
  await owner.setViewportSize({ width: 390, height: 844 });
  await owner.reload();
  await expect(owner.getByRole("heading", { name: "Members" })).toBeVisible();
  expect(await owner.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  // A used link no longer opens.
  const stranger = await (await browser.newContext()).newPage();
  await stranger.goto(link);
  await expect(stranger.getByRole("heading", { name: "Invitation not valid" })).toBeVisible();

  // The owner signs out and back in with email and password.
  await owner.getByRole("button", { name: "Sign out" }).click();
  // Wait for the sign-in screen: until sign-out lands, the settings page's
  // admin and change-password fields also match getByLabel("Password").
  await expect(owner.getByRole("heading", { name: "Sign in to GrantCrest" })).toBeVisible();
  await owner.getByLabel("Email").fill(ownerEmail);
  await owner.getByLabel("Password").fill(PASSWORD);
  await owner.getByRole("button", { name: "Sign in" }).click();
  await expect(owner.getByRole("main")).toBeVisible();
  await ownerContext.close();
});
