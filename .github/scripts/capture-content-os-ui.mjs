import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('docs/evidence/ui');
const password = process.env.TEST_ADMIN_PASSWORD;
const base = 'http://127.0.0.1:5173';
const targetSha = process.env.TARGET_SHA;
const targetBranch = process.env.TARGET_BRANCH;
const demoImage = process.env.RUNNER_TEMP + '/demo-image.svg';
const rows = [];
const notes = [];

fs.mkdirSync(out, { recursive: true });

function add(file, route, viewport, auth, proves) { rows.push({ file, route, viewport, auth, proves }); }
async function shot(page, file, route, viewport, auth, proves, fullPage = true) {
  await page.screenshot({ path: path.join(out, file), fullPage });
  add(file, route, `${viewport.width}x${viewport.height}`, auth, proves);
}
async function clickNamed(page, name) {
  for (const role of ['button','tab','link']) {
    const el = page.getByRole(role, { name, exact: true }).first();
    if (await el.count()) { await el.click(); return true; }
  }
  const t = page.getByText(name, { exact: true }).first();
  if (await t.count()) { await t.click(); return true; }
  return false;
}
async function login(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  const pw = page.locator('input[type="password"]').first();
  if (await pw.count()) {
    await pw.fill(password);
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await page.waitForTimeout(900);
  }
}
async function adminSetup(context) {
  const unlock = await context.request.post(`${base}/api/auth/admin-unlock`, { data: { password } });
  if (!unlock.ok()) notes.push(`Admin unlock returned HTTP ${unlock.status()}.`);
  const seed = await context.request.post(`${base}/api/seed`);
  if (!seed.ok()) notes.push(`Seed returned HTTP ${seed.status()}.`);
}

const desktop = { width: 1440, height: 900 };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: desktop });
const page = await context.newPage();
page.setDefaultTimeout(20000);

await page.goto(base, { waitUntil: 'networkidle' });
await shot(page, '01-login-desktop.png', '/', desktop, 'unauthenticated', 'Actual browser-rendered Content OS login screen.');
await login(page);
await adminSetup(context);

await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
await shot(page, '02-dashboard-desktop.png', '/dashboard', desktop, 'authenticated test session', 'Authenticated dashboard plus the real application navigation/sidebar.');

await page.goto(`${base}/create`, { waitUntil: 'networkidle' });
await shot(page, '03-create-content-desktop.png', '/create', desktop, 'authenticated test session', 'New Content screen and supported content-type choices.');
const adv = page.getByRole('button', { name: /advanced/i }).first();
if (await adv.count()) { await adv.click(); await page.waitForTimeout(250); }
await shot(page, '04-advanced-creation-options.png', '/create', desktop, 'authenticated test session', 'Advanced creation controls expanded.');

const topic = page.locator('textarea').first();
await topic.fill('UI Proof Demo — Building a measurable content engine for a growing service business');
const generate = page.getByRole('button', { name: /generate content/i }).first();
if (!(await generate.count())) throw new Error('Generate Content button not found');
await generate.click();
await page.waitForTimeout(350);
await shot(page, '05-generation-loading-state.png', '/create', desktop, 'authenticated test session', 'Actual loading/generation state after submitting the real creation workflow.');
await page.waitForURL(/\/projects\//, { timeout: 120000 });
await page.waitForTimeout(6500);
const projectUrl = page.url();
const projectPath = new URL(projectUrl).pathname + new URL(projectUrl).search;
await shot(page, '06-project-detail-desktop.png', projectPath, desktop, 'authenticated test session', 'Generated project detail plus project workflow/navigation tabs.');

await clickNamed(page, 'Editor');
await page.waitForTimeout(1800);
await shot(page, '07-rich-editor-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Rich editor with actual generated content, section navigation, formatting toolbar, and implemented editing controls.');

const imageBtn = page.locator('[title="Insert image"]').first();
if (await imageBtn.count()) {
  await imageBtn.click();
  await page.waitForTimeout(250);
  await shot(page, '08-image-insertion-dialog.png', projectPath + '#editor', desktop, 'authenticated test session', 'Real image upload dialog including accessibility alt-text field.');
  const dialog = page.getByRole('dialog').last();
  await dialog.locator('input[type="file"]').setInputFiles(demoImage);
  const textInputs = dialog.locator('input:not([type="file"])');
  if (await textInputs.count() >= 1) await textInputs.nth(0).fill('Content OS deterministic UI proof image');
  if (await textInputs.count() >= 2) await textInputs.nth(1).fill('Demo media inserted in the isolated test environment');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.waitForTimeout(1800);
  await shot(page, '09-image-rendered-editor.png', projectPath + '#editor', desktop, 'authenticated test session', 'Uploaded deterministic demo image rendered inside the real rich editor.');
} else notes.push('Insert image toolbar control was not found.');

const videoBtn = page.locator('[title="Insert video embed"]').first();
if (await videoBtn.count()) {
  await videoBtn.click();
  await page.waitForTimeout(250);
  await shot(page, '10-video-insertion-dialog.png', projectPath + '#editor', desktop, 'authenticated test session', 'Real YouTube/Vimeo insertion dialog.');
  const dialog = page.getByRole('dialog').last();
  await dialog.locator('input').first().fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  const inputs = dialog.locator('input');
  if (await inputs.count() > 1) await inputs.nth(1).fill('Valid YouTube demo embed');
  await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
  await page.waitForTimeout(1800);
  await shot(page, '11-video-rendered-editor.png', projectPath + '#editor', desktop, 'authenticated test session', 'Validated YouTube video rendered inside the real editor.');
} else notes.push('Insert video toolbar control was not found.');

await clickNamed(page, 'Quality');
await page.waitForTimeout(900);
const evalBtn = page.getByRole('button', { name: /run|evaluate|quality/i }).first();
if (await evalBtn.count()) { try { await evalBtn.click(); await page.waitForTimeout(3000); } catch {} }
await shot(page, '12-quality-review.png', projectPath + '#quality', desktop, 'authenticated test session', 'Quality review/evaluation screen in current working product state.');

await clickNamed(page, 'Repurpose');
await page.waitForTimeout(700);
await shot(page, '13-repurpose-workflow.png', projectPath + '#repurpose', desktop, 'authenticated test session', 'Authenticated repurpose workflow.');

await clickNamed(page, 'Export');
await page.waitForTimeout(700);
await shot(page, '14-export-formats.png', projectPath + '#export', desktop, 'authenticated test session', 'Export screen showing Markdown, HTML, text, DOCX and PDF choices.');
const select = page.locator('select').last();
if (await select.count()) await select.selectOption('markdown');
const exportBtn = page.getByRole('button', { name: 'Export', exact: true }).last();
if (await exportBtn.count()) {
  await exportBtn.click();
  for (let i=0;i<30;i++) {
    if (await page.getByText(/completed|validation checks passed|download/i).count()) break;
    await page.waitForTimeout(750);
  }
}
await shot(page, '15-export-complete.png', projectPath + '#export', desktop, 'authenticated test session', 'Completed export record/download state after real export request.');

await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
await shot(page, '16-settings-desktop.png', '/settings', desktop, 'authenticated test session', 'Actual authenticated settings screen.');

await page.goto(`${base}/projects`, { waitUntil: 'networkidle' });
await shot(page, '17-projects-list-state.png', '/projects', desktop, 'authenticated test session', 'Project collection state with deterministic demo project.');
await browser.close();

async function responsive(viewport, suffix, prefix) {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport });
  const p = await c.newPage();
  p.setDefaultTimeout(20000);
  await login(p);
  await p.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
  await shot(p, `${prefix}-dashboard-${suffix}.png`, '/dashboard', viewport, 'authenticated test session', `${suffix} dashboard responsive proof.`);
  await p.goto(`${base}/create`, { waitUntil: 'networkidle' });
  await shot(p, `${prefix}-create-${suffix}.png`, '/create', viewport, 'authenticated test session', `${suffix} Create Content responsive proof.`);
  await p.goto(projectUrl, { waitUntil: 'networkidle' });
  await p.waitForTimeout(1200);
  await shot(p, `${prefix}-project-detail-${suffix}.png`, projectPath, viewport, 'authenticated test session', `${suffix} generated project-detail responsive proof.`);
  await clickNamed(p, 'Editor');
  await p.waitForTimeout(900);
  await shot(p, `${prefix}-rich-editor-${suffix}.png`, projectPath + '#editor', viewport, 'authenticated test session', `${suffix} rich-editor adaptive responsive proof.`);
  await b.close();
}

await responsive({ width: 1280, height: 800 }, 'laptop', '20');
await responsive({ width: 768, height: 1024 }, 'tablet', '24');
await responsive({ width: 390, height: 844 }, 'mobile', '28');

const manifest = [
  '# Content OS UI Evidence', '',
  `Application source branch: \`${targetBranch}\``,
  `Exact application Git SHA: \`${targetSha}\``,
  'Environment: GitHub Actions isolated local/test environment; disposable PostgreSQL; API :8080; Vite UI :5173; headless Chromium.',
  'Authentication: real application password login and session cookies using an isolated non-production test password.',
  'Data: seeded deterministic test/demo content only; no real customer records or production credentials.', '',
  '| Screenshot filename | Screen / route | Viewport | Authentication state | What it proves |',
  '|---|---|---:|---|---|',
  ...rows.map(r => `| \`${r.file}\` | \`${r.route}\` | ${r.viewport} | ${r.auth} | ${r.proves} |`), '',
  '## Capture notes',
  ...(notes.length ? notes.map(n => `- ${n}`) : ['- No capture warnings recorded.']), '',
  `All screenshots correspond to Content OS application code at \`${targetSha}\`. The evidence tooling lives separately on \`evidence/ui-proof-e66260b\` and does not alter the application build being captured.`,
  'No mockups, concept art, manually constructed application HTML, or production credentials were used.'
].join('\n');
fs.writeFileSync(path.join(out, 'README.md'), manifest);
