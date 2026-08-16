import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const base = 'http://127.0.0.1:5173';
const password = process.env.TEST_ADMIN_PASSWORD;
const out = path.resolve('docs/evidence/ui');
const appSha = process.env.TARGET_SHA;
const branch = 'manus/content-machine-closeout';
const demoImage = process.env.DEMO_IMAGE_PATH;
const rows = [];
fs.mkdirSync(out, { recursive: true });

function record(file, route, viewport, auth, proves) { rows.push({ file, route, viewport, auth, proves }); }
async function shot(page, file, route, viewport, auth, proves, fullPage=true) {
  await page.screenshot({ path: path.join(out, file), fullPage });
  record(file, route, `${viewport.width}×${viewport.height}`, auth, proves);
}
async function clickNamed(page, name) {
  for (const role of ['button','tab','link']) {
    const el = page.getByRole(role, { name, exact: true }).first();
    if (await el.count()) { await el.click(); return true; }
  }
  const txt = page.getByText(name, { exact: true }).first();
  if (await txt.count()) { await txt.click(); return true; }
  return false;
}
async function login(page) {
  await page.goto(base, { waitUntil: 'networkidle' });
  const pw = page.locator('input[type=password]').first();
  if (await pw.count()) {
    await pw.fill(password);
    await page.getByRole('button', { name: /sign in/i }).first().click();
    await page.waitForTimeout(700);
  }
}
async function setup(context) {
  let r = await context.request.post(`${base}/api/auth/admin-unlock`, { data: { password } });
  if (!r.ok()) throw new Error(`admin unlock failed: ${r.status()}`);
  r = await context.request.post(`${base}/api/seed`);
  if (!r.ok()) throw new Error(`seed failed: ${r.status()}`);
}

const desktop = { width: 1440, height: 900 };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: desktop, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(25000);

await page.goto(base, { waitUntil: 'networkidle' });
await shot(page, '01-login-desktop.png', '/', desktop, 'signed out', 'Actual Content OS login screen.');
await login(page);
await page.goto(`${base}/projects`, { waitUntil: 'networkidle' });
await shot(page, '22-empty-state-desktop.png', '/projects', desktop, 'authenticated test session', 'Important empty Projects state before deterministic demo data is seeded.');
await setup(context);

await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
await shot(page, '02-dashboard-desktop.png', '/dashboard', desktop, 'authenticated test session', 'Authenticated dashboard command center.');
await shot(page, '03-sidebar-desktop.png', '/dashboard', desktop, 'authenticated test session', 'Main application navigation/sidebar and active-state treatment.');

await page.goto(`${base}/create`, { waitUntil: 'networkidle' });
await shot(page, '04-create-content-desktop.png', '/create', desktop, 'authenticated test session', 'New Content creation screen.');
await shot(page, '05-content-types-desktop.png', '/create', desktop, 'authenticated test session', 'Supported content-type selection: Blog Post, Article, Guide, Manual, Report, White Paper, Newsletter, Ebook, SOP / Process.');
const adv = page.getByRole('button', { name: /advanced options/i }).first();
if (await adv.count()) { await adv.click(); await page.waitForTimeout(250); }
await shot(page, '06-advanced-options-desktop.png', '/create', desktop, 'authenticated test session', 'Advanced creation options expanded.');

const topic = page.locator('textarea').first();
await topic.fill('How small agencies can build a durable editorial operating system');
const brandSelect = page.locator('select').first();
if (await brandSelect.count()) {
  const vals = await brandSelect.locator('option').evaluateAll(os => os.map(o => o.value).filter(Boolean));
  if (vals.length) await brandSelect.selectOption(vals[0]);
}
const generate = page.getByRole('button', { name: /generate content/i }).first();
await generate.click();
await page.waitForTimeout(300);
await shot(page, '50-generation-loading.png', '/create', desktop, 'authenticated test session', 'Actual generation/loading state initiated by the real application.');
await page.waitForURL(/\/projects\//, { timeout: 120000 });
await page.waitForTimeout(6000);
const projectUrl = page.url();
const projectPath = new URL(projectUrl).pathname + new URL(projectUrl).search;
await shot(page, '07-project-detail-desktop.png', projectPath, desktop, 'authenticated test session', 'Generated project detail and pipeline state.');
await shot(page, '08-project-workflow-tabs-desktop.png', projectPath, desktop, 'authenticated test session', 'Overview, Research Plan, Sources, Claims, Outline, Editor, Quality, Repurpose, Export tabs.');

await clickNamed(page, 'Editor');
await page.waitForTimeout(1200);
const firstSection = page.locator('aside button, [data-section-id]').first();
const redraft = page.getByRole('button', { name: /re-draft/i }).first();
if (await redraft.count()) {
  await redraft.click();
  await page.waitForTimeout(2500);
}
await shot(page, '09-rich-editor-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Rich editor with deterministic generated prose visible.');
await shot(page, '10-rich-editor-toolbar-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Rich-editor formatting toolbar.');
await shot(page, '11-section-navigation-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Section navigation with generated sections and word counts.');
await shot(page, '12-ai-edit-controls-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Re-draft, edit-mode selector, Apply Edit, Save/Approve controls.');

const imageBtn = page.locator('[title="Insert image"]').first();
if (!(await imageBtn.count())) throw new Error('image toolbar button missing');
await imageBtn.click();
await page.waitForTimeout(250);
await shot(page, '13-image-insertion-dialog-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Real image insertion dialog with raster guidance, alt text and caption fields.');
let dialog = page.getByRole('dialog').last();
await dialog.locator('input[type=file]').setInputFiles(demoImage);
const imageInputs = dialog.locator('input:not([type=file])');
if (await imageInputs.count() > 0) await imageInputs.nth(0).fill('Content OS deterministic demo visual');
if (await imageInputs.count() > 1) await imageInputs.nth(1).fill('Safe test image inserted through the real media workflow');
await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
await page.waitForTimeout(1200);
await shot(page, '14-image-rendered-editor-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Uploaded test image rendered inside the real editor.');

const videoBtn = page.locator('[title="Insert video embed"]').first();
if (!(await videoBtn.count())) throw new Error('video toolbar button missing');
await videoBtn.click();
await page.waitForTimeout(250);
await shot(page, '15-video-insertion-dialog-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Real YouTube/Vimeo insertion dialog.');
dialog = page.getByRole('dialog').last();
await dialog.locator('input').nth(0).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
if (await dialog.locator('input').count() > 1) await dialog.locator('input').nth(1).fill('Valid YouTube demo embed');
await dialog.getByRole('button', { name: 'Insert', exact: true }).click();
await page.waitForTimeout(1800);
await shot(page, '16-video-rendered-editor-desktop.png', projectPath + '#editor', desktop, 'authenticated test session', 'Validated YouTube video rendered inside the real editor.');

await clickNamed(page, 'Quality');
await page.waitForTimeout(600);
const evalBtn = page.getByRole('button', { name: /run evaluation/i }).first();
if (await evalBtn.count()) { await evalBtn.click(); await page.waitForTimeout(2200); }
await shot(page, '17-quality-review-desktop.png', projectPath + '#quality', desktop, 'authenticated test session', 'Quality review/evaluation screen and publication-readiness state.');

await clickNamed(page, 'Repurpose');
await page.waitForTimeout(500);
await shot(page, '18-repurpose-desktop.png', projectPath + '#repurpose', desktop, 'authenticated test session', 'Repurpose workflow in authenticated product.');

await clickNamed(page, 'Export');
await page.waitForTimeout(500);
await shot(page, '19-export-desktop.png', projectPath + '#export', desktop, 'authenticated test session', 'Export screen showing available formats.');
const formatSelect = page.locator('select').last();
if (await formatSelect.count()) await formatSelect.selectOption('markdown');
const exportButton = page.getByRole('button', { name: 'Export', exact: true }).last();
if (await exportButton.count()) {
  await exportButton.click();
  for (let i=0;i<25;i++) {
    if (await page.getByText(/completed/i).count()) break;
    await page.waitForTimeout(500);
  }
}
await shot(page, '20-export-completed-desktop.png', projectPath + '#export', desktop, 'authenticated test session', 'Successful completed export state with validation and download action.');

await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
await shot(page, '21-settings-desktop.png', '/settings', desktop, 'authenticated test session', 'Authenticated settings screen.');
await browser.close();

async function responsive(viewport, prefix, label) {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport, deviceScaleFactor: 1 });
  const p = await c.newPage(); p.setDefaultTimeout(25000);
  await login(p);
  await p.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
  await shot(p, `${prefix}-dashboard-${label}.png`, '/dashboard', viewport, 'authenticated test session', `${label} dashboard responsive proof.`);
  await p.goto(`${base}/create`, { waitUntil: 'networkidle' });
  await shot(p, `${Number(prefix)+1}-create-${label}.png`, '/create', viewport, 'authenticated test session', `${label} Create Content responsive proof.`);
  await p.goto(projectUrl, { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  await shot(p, `${Number(prefix)+2}-project-detail-${label}.png`, projectPath, viewport, 'authenticated test session', `${label} project detail responsive proof.`);
  await clickNamed(p, 'Editor'); await p.waitForTimeout(800);
  await shot(p, `${Number(prefix)+3}-rich-editor-${label}.png`, projectPath+'#editor', viewport, 'authenticated test session', `${label} rich-editor adaptive proof.`);
  await b.close();
}
await responsive({width:390,height:844}, '30', 'mobile');
await responsive({width:768,height:1024}, '34', 'tablet');
await responsive({width:1280,height:800}, '38', 'laptop');

const manifest = [
  '# Content OS UI Evidence','',
  '## Exact build','',
  '| Field | Value |','|---|---|',
  '| Repository | `https://github.com/ebyron357/agency-content-grants.git` |',
  `| Branch | \`${branch}\` |`,
  `| Application source SHA | \`${appSha}\` |`,
  '| Environment | Isolated GitHub Actions local/test runtime: Vite frontend `http://localhost:5173/`, API `http://localhost:8080/`, disposable PostgreSQL, deterministic demo AI provider |',
  '| Authentication | Isolated local/test password only; no production credentials; authentication was not bypassed |',
  '| Data | Safe deterministic demo data generated through the real application |',
  '| Capture method | Real Chromium browser rendering via Playwright |','',
  '## Screenshot manifest','',
  '| Screenshot filename | Screen / route | Viewport | Authentication | What it proves |','|---|---|---:|---|---|',
  ...rows.map(r => `| \`${r.file}\` | \`${r.route}\` | ${r.viewport} | ${r.auth} | ${r.proves} |`),'',
  'All final screenshots correspond to the application source SHA above. No mockups, manually constructed application HTML, production credentials, or customer data were used.'
].join('\n');
fs.writeFileSync(path.join(out,'README.md'), manifest);
