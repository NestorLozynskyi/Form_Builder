import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { signUp, uid } from './helpers';

/**
 * The editor header never clips or overlaps the status cluster and the actions, for the longest combinations
 * (Closed · vN + Unpublished changes + Save failed + N issues; Draft + Saving… + N issues) at every form factor.
 */
async function xsrf(page: Page) {
  return decodeURIComponent((await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '');
}
async function call(page: Page, req: APIRequestContext, method: string, url: string, data?: unknown) {
  const r = await req.fetch(url, { method, data, headers: { 'X-XSRF-TOKEN': await xsrf(page) } });
  expect(r.ok(), `${method} ${url}`).toBeTruthy();
  return r.status() === 204 ? null : r.json();
}

const schema = (title: string, pattern = '') => ({
  title, description: '', successMessage: 'Thanks!', accent: 'teal',
  blocks: [
    { id: 'a', type: 'short', label: 'Full name', required: true, pattern },
    { id: 'b', type: 'checkbox', label: 'Pick', options: ['One', ''], minSelected: 3, maxSelected: 1 },
    { id: 'c', type: 'email', label: '' },
  ],
});

/** Every visible element of the status cluster lies left of the first visible action, inside the viewport. */
async function assertHeaderFits(page: Page) {
  const r = await page.evaluate(() => {
    const vis = (e: Element) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
    const header = document.querySelector('.ed-header .fb-header__inner')!;
    const actions = [...header.querySelectorAll('.fb-header__actions > *')].filter(vis);
    const actionsLeft = Math.min(...actions.map((a) => a.getBoundingClientRect().left));
    const title = document.querySelector('#ed-title')!.getBoundingClientRect();
    const meta = [...document.querySelectorAll('.ed-meta--inline > *, .ed-meta--inline app-editor-meta > *')].filter(vis).map((e) => e.getBoundingClientRect());
    const status = [...document.querySelectorAll('.ed-statusbar > app-editor-meta > *, .ed-statusbar > *')].filter(vis).map((e) => e.getBoundingClientRect());
    return {
      vw: innerWidth, actionsLeft, actionsRight: Math.max(...actions.map((a) => a.getBoundingClientRect().right)),
      titleRight: title.right, titleWidth: title.width,
      metaRight: meta.length ? Math.max(...meta.map((b) => b.right)) : 0, metaCount: meta.length,
      statusRight: status.length ? Math.max(...status.map((b) => b.right)) : 0,
      scrollW: document.documentElement.scrollWidth,
    };
  });
  expect(r.actionsRight).toBeLessThanOrEqual(r.vw);
  expect(r.titleRight).toBeLessThanOrEqual(r.actionsLeft);
  expect(r.metaRight).toBeLessThanOrEqual(r.actionsLeft);
  expect(r.statusRight).toBeLessThanOrEqual(r.vw);
  expect(r.scrollW).toBeLessThanOrEqual(r.vw);
  expect(r.titleWidth).toBeGreaterThan(40);
  return r;
}

test('editor header fits the longest status combinations at 1440, 1200, 834 and 390', async ({ page }) => {
  test.setTimeout(120_000);
  await signUp(page);
  const req = page.request;
  // closed form: v1 published, then closed, then an unpublished draft with configuration issues
  const closed = await call(page, req, 'POST', '/api/forms');
  await call(page, req, 'PUT', `/api/forms/${closed.id}/draft`, { ...schema(`Customer feedback survey ${uid()}`), blocks: [{ id: 'a', type: 'short', label: 'Full name', required: true }] });
  await call(page, req, 'POST', `/api/forms/${closed.id}/publish`);
  await call(page, req, 'POST', `/api/forms/${closed.id}/close`);
  await call(page, req, 'PUT', `/api/forms/${closed.id}/draft`, schema('Customer feedback survey with a very long title that keeps going', '(a+)+$'));
  // draft form with issues
  const draft = await call(page, req, 'POST', '/api/forms');
  await call(page, req, 'PUT', `/api/forms/${draft.id}/draft`, schema('Untitled registration form for the design week', '[a-z'));

  for (const width of [1440, 1200, 834, 390]) {
    await page.setViewportSize({ width, height: 900 });

    // Closed · v1 + Unpublished changes + Save failed (+ Retry) + issues
    await page.goto(`/forms/${closed.id}/edit`);
    await expect(page.locator('.fb-badge--closed:visible').first()).toContainText('Closed · v1');
    await page.route('**/api/forms/*/draft', (r) => r.abort());
    await page.locator('#ed-title').fill('Customer feedback survey with a very long title that keeps going!');
    await expect(page.locator('.fb-save--failed:visible').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.fb-badge--unpublished:visible').first()).toBeVisible();
    await expect(page.locator('.ed-issues:visible').first()).toContainText('issues');
    await assertHeaderFits(page);
    await page.screenshot({ path: `../docs/screenshots/app/editor--header-worst-closed-unpublished-failed-issues--${width}--light.png` });
    await page.unroute('**/api/forms/*/draft');

    // Draft + Saving… + issues
    await page.goto(`/forms/${draft.id}/edit`);
    await page.route('**/api/forms/*/draft', async (r) => { await new Promise((x) => setTimeout(x, 3000)); await r.continue().catch(() => {}); });
    await page.locator('#ed-title').fill('Untitled registration form for the design week 2026');
    await expect(page.locator('.fb-save--saving:visible').first()).toBeVisible();
    await expect(page.locator('.fb-badge--draft:visible').first()).toBeVisible();
    await assertHeaderFits(page);
    await page.unroute('**/api/forms/*/draft');
  }
});
