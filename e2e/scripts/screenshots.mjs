// Evidence screenshots of the real app through Caddy (Chromium).
// Usage: node scripts/screenshots.mjs [defaults|states|all]   (E2E_BASE_URL overrides http://127.0.0.1:8180)
// Output: docs/screenshots/app/<screen>--<state>--<width>--<theme>.png
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { B, api, createForm, feedbackSchema, publish, seedFeedback, signUp, submit } from '../lib/seed.mjs';

const out = fileURLToPath(new URL('../../docs/screenshots/app/', import.meta.url));
mkdirSync(out, { recursive: true });
const mode = process.argv[2] ?? 'all';
const WIDTHS = [1440, 834, 390];
const THEMES = ['light', 'dark'];
const browser = await chromium.launch();
const uid = Date.now().toString(36);
const done = [];

async function newCtx(width, theme, storage) {
  const ctx = await browser.newContext({
    viewport: { width, height: width >= 1200 ? 900 : width >= 768 ? 1112 : 844 },
    colorScheme: theme,
    isMobile: width < 768,
    hasTouch: width < 768,
    deviceScaleFactor: 1,
    acceptDownloads: true,
    storageState: storage,
  });
  await ctx.addInitScript((t) => localStorage.setItem('fb-theme', t), theme);
  return ctx;
}

async function shot(page, screen, state, { full = false } = {}) {
  const vp = page.viewportSize();
  const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  const name = `${screen}--${state}--${vp.width}--${theme}.png`;
  await page.waitForTimeout(350);
  await page.screenshot({ path: out + name, fullPage: full });
  done.push(name);
  console.log(name);
}

async function settle(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------- seed one author account with realistic data
const seedCtx = await browser.newContext();
const email = `alex.morgan+${uid}@example.com`;
await signUp(seedCtx, email);
const fb = await seedFeedback(seedCtx, 'teal');
// unpublished change on top of v2 (editor default state shows "Unpublished changes")
const s3 = feedbackSchema('teal');
s3.blocks = s3.blocks.filter((b) => b.id !== 'phone');
s3.description = 'Tell us how Form Builder works for you. It takes about 3 minutes.';
s3.blocks[0].help = '2–80 characters. Use the name we should address you by.';
await api(seedCtx, 'PUT', `/api/forms/${fb.id}/draft`, s3);
const draftId = await createForm(seedCtx, { ...feedbackSchema('cobalt'), title: 'Frontend engineer application', blocks: feedbackSchema().blocks.slice(0, 4) });
const closedId = await createForm(seedCtx, { ...feedbackSchema('magenta'), title: 'Workshop RSVP — October' });
const closedPub = await publish(seedCtx, closedId);
await submit(seedCtx, closedPub.publicId, 1, { name: 'Lena Fischer', email: 'lena@example.com', sat: '4', features: ['Form editor'], country: 'Germany' });
await api(seedCtx, 'POST', `/api/forms/${closedId}/close`);
const emptyId = await createForm(seedCtx, { ...feedbackSchema('green'), title: 'Design Week 2026 registration' });
const emptyPub = await publish(seedCtx, emptyId);
const indigoId = await createForm(seedCtx, { ...feedbackSchema('#7A3EF0'), title: 'Bug report' });
const indigoPub = await publish(seedCtx, indigoId);
const storage = await seedCtx.storageState();
const detail = await api(seedCtx, 'GET', `/api/forms/${fb.id}/responses?page=1&pageSize=20`);
const newest = detail.items[0].id;
const oldest = detail.items[detail.items.length - 1].id;
await seedCtx.close();

const editorUrl = `/forms/${fb.id}/edit`;

// ---------------------------------------------------------------- 1. every screen, default state, 3 widths × 2 themes
if (mode === 'defaults' || mode === 'all') {
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const anon = await newCtx(w, theme);
      const a = await anon.newPage();
      await a.goto(B + '/sign-up'); await settle(a); await shot(a, 'sign-up', 'default');
      await a.goto(B + '/sign-in'); await settle(a); await shot(a, 'sign-in', 'default');
      await a.goto(`${B}/f/${fb.publicId}`); await settle(a); await shot(a, 'public-form', 'filling');
      await anon.close();

      const ctx = await newCtx(w, theme, storage);
      const p = await ctx.newPage();
      await p.goto(B + '/forms'); await settle(p); await shot(p, 'forms', 'list');
      await p.goto(B + editorUrl); await settle(p); await shot(p, 'editor', 'default');
      await p.goto(`${B}/forms/${fb.id}/preview`); await settle(p); await shot(p, 'preview', 'default');
      await p.goto(`${B}/forms/${fb.id}/responses`); await settle(p); await shot(p, 'responses', 'table');
      await p.goto(`${B}/forms/${fb.id}/responses/${newest}`); await settle(p); await shot(p, 'response-detail', 'current');
      await p.goto(B + '/no-such-page'); await settle(p); await shot(p, '404', 'default');
      await p.route('**/api/forms', (r) => r.fulfill({ status: 500, contentType: 'application/problem+json', body: JSON.stringify({ title: 'An error occurred while processing your request.', status: 500, traceId: '00-7f3k92qd4e1a-01' }) }));
      await p.goto(B + '/forms'); await settle(p); await shot(p, 'error', 'default');
      await p.unroute('**/api/forms');
      await ctx.close();
    }
  }
}

// ---------------------------------------------------------------- 2. key states
if (mode === 'states' || mode === 'all') {
  const D = 1440;
  // ---- auth
  {
    const ctx = await newCtx(D, 'light');
    const p = await ctx.newPage();
    await p.goto(B + '/sign-up'); await settle(p);
    await p.fill('#su-email', 'alex.morgan@example'); await p.fill('#su-password', 'sun12'); await p.fill('#su-confirm', 'sun123');
    await p.click('button[type=submit]'); await shot(p, 'sign-up', 'field-errors');
    await p.fill('#su-email', email); await p.fill('#su-password', 'Maple-river-42'); await p.fill('#su-confirm', 'Maple-river-42');
    await p.click('button[type=submit]'); await p.waitForSelector('.fb-error'); await shot(p, 'sign-up', 'email-taken');
    await p.route('**/api/auth/sign-up', (r) => r.abort());
    await p.fill('#su-email', `jordan.lee+${uid}@example.com`); await p.click('button[type=submit]'); await p.waitForSelector('.fb-alert--danger'); await shot(p, 'sign-up', 'network-error');
    await p.goto(B + '/sign-in'); await settle(p);
    await p.fill('#si-email', email); await p.fill('#si-password', 'wrong-password'); await p.click('button[type=submit]');
    await p.waitForSelector('.fb-alert--danger'); await shot(p, 'sign-in', 'invalid-credentials');
    await p.goto(B + '/sign-in?signedOut=1'); await settle(p); await shot(p, 'sign-in', 'signed-out');
    await ctx.close();
  }
  // ---- forms: empty, delete confirm, account menu, toast
  {
    const ctx = await newCtx(D, 'light');
    await signUp(ctx, `sam.rivera+${uid}@example.com`);
    const p = await ctx.newPage();
    await p.goto(B + '/forms'); await settle(p); await shot(p, 'forms', 'empty');
    await ctx.close();
    const c2 = await newCtx(D, 'light', storage);
    const q = await c2.newPage();
    await q.route('**/api/forms', async (r) => { await new Promise((x) => setTimeout(x, 4000)); await r.continue().catch(() => {}); });
    await q.goto(B + '/forms'); await q.waitForTimeout(500); await shot(q, 'forms', 'loading');
    await q.unroute('**/api/forms'); await settle(q);
    await q.locator('tr', { hasText: 'Workshop RSVP' }).getByRole('button', { name: /Actions for/ }).click(); await shot(q, 'forms', 'row-menu');
    await q.getByRole('menuitem', { name: 'Delete…' }).click(); await shot(q, 'forms', 'delete-confirm');
    await q.keyboard.press('Escape');
    await q.locator('.fb-account__trigger').click(); await shot(q, 'header', 'account-menu');
    await q.keyboard.press('Escape');
    await q.locator('.forms-search input').fill('zzz'); await shot(q, 'forms', 'no-matches');
    await c2.close();
  }
  // ---- editor states
  {
    const ctx = await newCtx(D, 'light', storage);
    const p = await ctx.newPage();
    // empty canvas (new draft)
    await p.goto(B + '/forms'); await settle(p);
    await p.getByRole('button', { name: 'New form' }).click(); await p.waitForURL('**/edit'); await settle(p);
    await shot(p, 'editor', 'empty');
    // dragging a palette item onto the canvas (CDK)
    await p.locator('.fb-palette__item', { hasText: 'Short text' }).click(); await p.locator('.fb-palette__item', { hasText: 'Long text' }).click();
    const src = await p.locator('.fb-palette__item', { hasText: 'Email' }).first().boundingBox();
    const dst = await p.locator('.fb-block').nth(1).boundingBox();
    await p.mouse.move(src.x + 30, src.y + 20); await p.mouse.down();
    await p.mouse.move(src.x + 60, src.y + 30, { steps: 5 });
    await p.mouse.move(dst.x + 200, dst.y + 10, { steps: 25 });
    await shot(p, 'editor', 'dragging');
    await p.mouse.up(); await p.waitForTimeout(400);
    await shot(p, 'editor', 'dropped');

    await p.goto(B + editorUrl); await settle(p);
    const types = [['props-short-text', 'name'], ['props-long-text', 'comments'], ['props-email', 'email'], ['props-number', 'count'], ['props-date', 'start'], ['props-radio', 'source'], ['props-checkbox', 'features'], ['props-dropdown', 'country'], ['props-scale', 'sat'], ['props-heading', 'h1'], ['props-description', 'd1']];
    for (const [state, id] of types) {
      await p.locator(`.fb-block[data-id="${id}"] .fb-block__head`).click();
      await p.locator(`.fb-block[data-id="${id}"]`).scrollIntoViewIfNeeded();
      await shot(p, 'editor', state);
    }
    // form settings + low contrast accent
    await p.getByRole('tab', { name: 'Form settings' }).click(); await shot(p, 'editor', 'form-settings');
    await p.locator('#s-hex').fill('#F5C518'); await p.waitForTimeout(300);
    await p.locator('#s-contrast').scrollIntoViewIfNeeded(); await shot(p, 'editor', 'accent-low-contrast');
    await p.locator('.fb-swatch input[value="teal"]').check({ force: true });
    // configuration errors
    await p.getByRole('tab', { name: 'Field' }).click();
    await p.locator('.fb-block[data-id="name"] .fb-block__head').click();
    await p.locator('#p-pattern').fill('(a+)+$');
    await p.locator('#p-minLength').fill('500');
    await p.locator('.fb-block[data-id="features"] .fb-block__head').click();
    await p.locator('#p-opt-2').fill('');
    await p.locator('.fb-block[data-id="name"] .fb-block__head').click();
    await p.locator('.fb-block[data-id="name"]').scrollIntoViewIfNeeded();
    await shot(p, 'editor', 'config-errors');
    await p.locator('.ed-issues').first().click(); await shot(p, 'editor', 'config-errors-menu');
    await p.keyboard.press('Escape');
    await p.locator('#p-pattern').fill('^[A-Za-z ]+$'); await p.locator('#p-minLength').fill('2');
    await p.locator('.fb-block[data-id="features"] .fb-block__head').click(); await p.locator('#p-opt-2').fill('CSV export');
    // autosave states
    await p.route('**/api/forms/*/draft', async (r) => { await new Promise((x) => setTimeout(x, 5000)); await r.continue().catch(() => {}); });
    await p.locator('#ed-title').fill('Customer feedback survey 2026');
    await p.waitForTimeout(1200); await shot(p, 'editor', 'saving');
    await p.unroute('**/api/forms/*/draft');
    await p.waitForTimeout(5500); await shot(p, 'editor', 'saved');
    await p.route('**/api/forms/*/draft', (r) => r.abort());
    await p.locator('#ed-title').fill('Customer feedback survey');
    await p.waitForTimeout(1800); await shot(p, 'editor', 'save-failed');
    await p.unroute('**/api/forms/*/draft');
    await p.getByRole('button', { name: 'Retry now' }).click(); await p.waitForTimeout(1500);
    // publish changes dialog + published
    await p.locator('#ed-publish').click(); await shot(p, 'editor', 'publish-dialog');
    await p.locator('dialog[open]').getByRole('button', { name: 'Publish changes', exact: true }).click();
    await p.waitForSelector('#dlg-published-link'); await p.waitForTimeout(400); await shot(p, 'editor', 'published');
    await p.locator('dialog[open]').getByRole('button', { name: 'Done' }).click(); await p.waitForTimeout(300);
    // close responses dialog + closed
    await p.getByRole('button', { name: 'More actions' }).click(); await shot(p, 'editor', 'more-menu');
    await p.getByRole('menuitem', { name: 'Close responses' }).click(); await shot(p, 'editor', 'close-confirm');
    await p.locator('dialog[open]').getByRole('button', { name: 'Close responses' }).click(); await p.waitForTimeout(500);
    await shot(p, 'editor', 'closed');
    await p.locator('.fb-banner').getByRole('button', { name: 'Reopen responses' }).click(); await p.waitForTimeout(500);
    // field deleted (undo toast)
    await p.locator('.fb-block[data-id="count"]').getByRole('button', { name: 'Delete' }).click(); await p.waitForTimeout(300);
    await shot(p, 'editor', 'field-deleted');
    await p.getByRole('button', { name: 'Undo' }).click();
    // first publish of a draft
    await p.goto(`${B}/forms/${draftId}/edit`); await settle(p); await p.locator('#ed-publish').click(); await shot(p, 'editor', 'first-publish');
    await p.keyboard.press('Escape');
    await ctx.close();

    for (const w of [834, 390]) {
      const c = await newCtx(w, 'light', storage);
      const m = await c.newPage();
      await m.goto(B + editorUrl); await settle(m);
      if (w < 768) {
        await m.locator('.ed-mobilebar').getByRole('button', { name: 'Add field' }).click(); await shot(m, 'editor', 'mobile-palette');
        await m.locator('.ed-scrim').click({ position: { x: 10, y: 10 } });
        await m.locator('.fb-block[data-id="sat"] .fb-block__head').click();
        await m.locator('.ed-mobilebar').getByRole('button', { name: 'Properties' }).click(); await shot(m, 'editor', 'mobile-props');
      } else {
        await m.locator('.fb-block[data-id="sat"] .fb-block__head').click(); await shot(m, 'editor', 'tablet-props-drawer');
      }
      // configuration errors on tablet / mobile (status strip with Published · vN + Unpublished + save state + issues)
      const props = async (id) => {
        await m.locator('.ed-scrim:visible').click({ position: { x: 10, y: 10 } }).catch(() => {});
        await m.locator(`.fb-block[data-id="${id}"] .fb-block__head`).click();
        if (w < 768) await m.locator('.ed-mobilebar').getByRole('button', { name: 'Properties' }).click();
      };
      await props('name');
      await m.locator('#p-pattern').fill('(a+)+$'); await m.locator('#p-minLength').fill('500');
      await props('features');
      await m.locator('#p-opt-2').fill('');
      await m.getByRole('button', { name: 'Close properties' }).click();
      await m.locator('.fb-block[data-id="name"]').scrollIntoViewIfNeeded(); await m.evaluate(() => scrollTo(0, 0));
      await m.waitForTimeout(1200); await shot(m, 'editor', 'config-errors');
      await props('name');
      await m.locator('#p-pattern').fill('^[A-Za-z ]+$'); await m.locator('#p-minLength').fill('2');
      await props('features');
      await m.locator('#p-opt-2').fill('CSV export');
      await m.waitForTimeout(1500);
      await c.close();
    }
  }
  // ---- preview
  {
    const ctx = await newCtx(D, 'light', storage);
    const p = await ctx.newPage();
    await p.goto(`${B}/forms/${fb.id}/preview`); await settle(p);
    await p.getByLabel(/^Full name/).fill('Jordan Lee'); await p.getByLabel(/^Email address/).fill('jordan.lee@example.com');
    await p.locator('.fb-scale__item', { hasText: '4' }).click(); await p.getByText('Form editor').click(); await p.getByLabel(/^Country/).selectOption('Canada');
    await shot(p, 'preview', 'filled');
    await p.getByRole('button', { name: 'Submit' }).click(); await shot(p, 'preview', 'submit-toast');
    await ctx.close();
  }
  // ---- public form states
  {
    for (const theme of THEMES) {
      for (const [label, pid] of [['teal', fb.publicId], ['custom-7A3EF0', indigoPub.publicId]]) {
        const ctx = await newCtx(D, theme);
        const p = await ctx.newPage();
        await p.goto(`${B}/f/${pid}`); await settle(p);
        await p.getByLabel(/^Full name/).fill('Anna Kovalenko'); await p.locator('.fb-scale__item', { hasText: '4' }).click(); await p.getByText('Form editor').click();
        await p.getByLabel(/^Country/).focus();
        await shot(p, 'public-form', `accent-${label}`);
        await ctx.close();
      }
    }
    const ctx = await newCtx(D, 'light');
    const p = await ctx.newPage();
    await p.goto(`${B}/f/${fb.publicId}`); await settle(p);
    await p.getByRole('button', { name: 'Submit' }).click(); await shot(p, 'public-form', 'errors');
    await p.getByLabel(/^Full name/).fill('A'); await p.getByLabel(/^Order number/).fill('FB-12345'); await p.getByLabel(/^Email address/).fill('anna.k@example');
    await p.getByLabel(/^How many forms/).fill('750'); await p.getByLabel(/^When did you start/).fill('2023-11-20');
    await p.getByRole('button', { name: 'Submit' }).click(); await shot(p, 'public-form', 'errors-alt');
    await p.getByLabel(/^Full name/).fill('Anna Kovalenko'); await p.getByLabel(/^Order number/).fill('FB-204518'); await p.getByLabel(/^Email address/).fill('anna.k@example.com');
    await p.getByLabel(/^How many forms/).fill('12'); await p.getByLabel(/^When did you start/).fill('2025-03-14');
    await p.locator('.fb-scale__item', { hasText: '4' }).click(); await p.getByText('Form editor').click(); await p.getByLabel(/^Country/).selectOption('Ukraine');
    await shot(p, 'public-form', 'filled', { full: true });
    await p.route('**/api/public/forms/*/responses', (r) => r.abort());
    await p.getByRole('button', { name: 'Submit' }).click(); await p.waitForSelector('.pf-banner'); await shot(p, 'public-form', 'network-error');
    await p.unroute('**/api/public/forms/*/responses');
    await p.route('**/api/public/forms/*/responses', async (r) => { await new Promise((x) => setTimeout(x, 3000)); await r.continue().catch(() => {}); });
    await p.getByRole('button', { name: 'Submit' }).click(); await p.waitForTimeout(300); await shot(p, 'public-form', 'submitting');
    await p.waitForSelector('text=Response submitted'); await shot(p, 'public-form', 'success');
    await p.unroute('**/api/public/forms/*/responses');
    // rate limited: real 429 from the server
    for (let i = 0; i < 12; i++) {
      const r = await ctx.request.post(`${B}/api/public/forms/${emptyPub.publicId}/responses`, { data: { version: 1, answers: { name: 'Rate test', email: 'r@example.com', sat: '3', features: ['Form editor'], country: 'Canada' }, website: '' } });
      if (r.status() === 429) break;
    }
    await p.goto(`${B}/f/${emptyPub.publicId}`); await settle(p);
    await p.getByLabel(/^Full name/).fill('Rate Test'); await p.getByLabel(/^Email address/).fill('r@example.com');
    await p.locator('.fb-scale__item', { hasText: '3' }).click(); await p.getByText('Form editor').click(); await p.getByLabel(/^Country/).selectOption('Canada');
    await p.getByRole('button', { name: 'Submit' }).click(); await p.waitForSelector('.fb-alert--warning'); await shot(p, 'public-form', 'rate-limited');
    await p.goto(`${B}/f/${closedPub.publicId}`); await settle(p); await shot(p, 'public-form', 'closed');
    await p.goto(`${B}/f/AAAAAAAAAAAAAAAAAAAAAA`); await settle(p); await shot(p, 'public-form', 'not-available');
    await p.goto(`${B}/f/${draftId}`); await settle(p); await shot(p, 'public-form', 'not-available-malformed');
    await ctx.close();
  }
  // ---- responses
  {
    const ctx = await newCtx(D, 'light', storage);
    const p = await ctx.newPage();
    await p.goto(`${B}/forms/${emptyId}/responses`); await settle(p);
    await p.goto(`${B}/forms/${closedId}/responses`); await settle(p); await shot(p, 'responses', 'closed');
    await p.goto(`${B}/forms/${indigoId}/responses`); await settle(p); await shot(p, 'responses', 'empty');
    await p.goto(`${B}/forms/${fb.id}/responses/${oldest}`); await settle(p); await shot(p, 'response-detail', 'old-version', { full: true });
    await p.getByRole('button', { name: 'Delete response' }).click(); await shot(p, 'response-detail', 'delete-confirm');
    await p.keyboard.press('Escape');
    await p.goto(`${B}/forms/${fb.id}/responses/01a1ae86-0000-7000-8000-000000000000`); await settle(p); await shot(p, 'response-detail', 'not-found');
    await p.goto(`${B}/forms/${fb.id}/responses`); await settle(p);
    await p.locator('.resp-table tbody tr').first().getByRole('button', { name: /More actions/ }).click();
    await p.getByRole('menuitem', { name: 'Delete…' }).click(); await shot(p, 'responses', 'delete-confirm');
    await p.keyboard.press('Escape');
    await p.route('**/responses/export.csv', (r) => r.fulfill({ status: 500, body: '' }));
    await p.getByRole('button', { name: 'Export CSV' }).click(); await p.waitForTimeout(600); await shot(p, 'responses', 'export-error');
    await p.unroute('**/responses/export.csv');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Export CSV' }).click()]);
    await dl.saveAs(fileURLToPath(new URL('../../docs/samples/seeded-export.csv', import.meta.url)));
    await p.waitForTimeout(300); await shot(p, 'responses', 'export');
    await ctx.close();
    for (const w of [390]) {
      const c = await newCtx(w, 'dark', storage);
      const m = await c.newPage();
      await m.goto(`${B}/forms/${fb.id}/responses/${oldest}`); await settle(m); await shot(m, 'response-detail', 'old-version', { full: true });
      await c.close();
    }
  }
}

console.log(`\n${done.length} screenshots → ${out}`);
await browser.close();
