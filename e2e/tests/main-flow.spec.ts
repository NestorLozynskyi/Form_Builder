import { Browser, expect, Page, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { addBlock, closeProps, isMobile, openProps, saved, selectBlock, signUp, uid } from './helpers';

/**
 * Main end-to-end scenario through Caddy (acceptance steps 1–11), run on desktop and on a 390px phone:
 * sign up → build a form with every block type and rule → publish v1 → anonymous respondent with validation errors,
 * then a valid submission → draft edit doesn't touch the live form → publish v2 without a field → answer v2 →
 * both responses render correctly → close / reopen → CSV export → delete response and form.
 */
for (const vp of [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]) {
  test.describe(`main flow (${vp.name})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.name === 'mobile', isMobile: vp.name === 'mobile' });

    test('author builds, publishes and manages a form; respondent answers', async ({ page, browser }) => {
      test.setTimeout(180_000);
      await signUp(page);
      await expect(page.getByRole('heading', { name: 'No forms yet' })).toBeVisible();

      // 2. create a form with every field type and rule
      await page.getByRole('button', { name: 'New form' }).click();
      await page.waitForURL('**/edit');
      await expect(page.locator('#ed-dropzone')).toBeVisible();
      const title = `E2E survey ${uid()}`;
      await page.locator('#ed-title').fill(title);

      await configure(page, 'Short text', async (p) => {
        await p.locator('#p-label').fill('Full name');
        await p.getByRole('switch', { name: 'Required' }).check();
        await p.locator('#p-minLength').fill('2');
        await p.locator('#p-maxLength').fill('80');
      });
      await configure(page, 'Short text', async (p) => {
        await p.locator('#p-label').fill('Order number');
        await p.locator('#p-pattern').fill('(a+)+$');
        await expect(p.getByText('Avoid nested repeats like (a+)+')).toBeVisible();
        await p.locator('#p-pattern').fill('^FB-\\d{6}$');
        await p.locator('#p-patternMessage').fill('Enter an order number like FB-123456.');
      });
      await configure(page, 'Email', async (p) => {
        await p.locator('#p-label').fill('Email address');
        await p.getByRole('switch', { name: 'Required' }).check();
      });
      await addBlock(page, 'Section heading');
      await configure(page, 'Description', async (p) => p.locator('#p-text').fill('Answer based on the last 30 days.'));
      await configure(page, 'Scale', async (p) => {
        await p.locator('#p-label').fill('How satisfied are you?');
        await p.getByRole('switch', { name: 'Required' }).check();
        await p.locator('#p-left').fill('Not at all');
        await p.locator('#p-right').fill('Very');
      });
      await configure(page, 'Multiple choice', async (p) => {
        await p.locator('#p-label').fill('Features');
        await p.locator('#p-opt-0').fill('Editor');
        await p.locator('#p-opt-1').fill('');
        await expect(p.getByText('Option 2 is empty.')).toBeVisible();
        await p.locator('#p-opt-1').fill('Export, CSV');
        await p.getByRole('button', { name: 'Add option' }).click();
        await p.locator('#p-opt-2').fill('Links');
        await p.locator('#p-minSel').fill('1');
        await p.locator('#p-maxSel').fill('2');
        await p.getByRole('switch', { name: 'Required' }).check();
      });
      await configure(page, 'Single choice', async (p) => {
        await p.locator('#p-label').fill('Source');
        await p.locator('#p-opt-0').fill('Search');
        await p.locator('#p-opt-1').fill('Friend');
      });
      await configure(page, 'Number', async (p) => {
        await p.locator('#p-label').fill('How many forms?');
        await p.locator('#p-min').fill('1');
        await p.locator('#p-max').fill('500');
        await p.getByRole('switch', { name: 'Whole numbers only' }).check();
      });
      await configure(page, 'Date', async (p) => {
        await p.locator('#p-label').fill('Start date');
        await p.locator('#p-earliest').fill('2024-01-01');
        await p.locator('#p-latestMode').selectOption('today');
      });
      await configure(page, 'Dropdown', async (p) => {
        await p.locator('#p-label').fill('Country');
        await p.locator('#p-opt-0').fill('Canada');
        await p.locator('#p-opt-1').fill('Ukraine');
        await p.getByRole('switch', { name: 'Required' }).check();
      });
      await configure(page, 'Long text', async (p) => {
        await p.locator('#p-label').fill('Comments');
        await p.locator('#p-maxLength').fill('1000');
      });
      await expect(page.locator('.fb-block')).toHaveCount(12);
      await saved(page);

      // 3. publish v1
      const link = await publish(page, true, 1);
      expect(link).toMatch(/\/f\/[A-Za-z0-9_-]{22}$/);

      // 4. anonymous respondent: validation errors, then a valid response
      const anon = await respondent(browser, vp);
      await anon.goto(link);
      await expect(anon.getByRole('heading', { name: title })).toBeVisible();
      await anon.getByRole('button', { name: 'Submit' }).click();
      const summary = anon.locator('.pf-summary');
      await expect(summary).toBeFocused();
      await expect(summary.getByRole('heading')).toHaveText('Fix 5 problems to submit');
      await anon.getByLabel(/^Full name/).fill('A');
      await anon.getByLabel(/^Order number/).fill('FB-12');
      await anon.getByLabel(/^Email address/).fill('anna@example');
      await anon.getByLabel(/^How many forms/).fill('12.5');
      await anon.getByRole('button', { name: 'Submit' }).click();
      await expect(anon.locator('.fb-error', { hasText: 'Use at least 2 characters — you’re at 1.' })).toBeVisible();
      await expect(anon.getByText('Enter an order number like FB-123456.').first()).toBeVisible();
      await expect(anon.getByText('Enter an email address like name@example.com.').first()).toBeVisible();
      await expect(anon.getByText('Enter a whole number, without decimals.').first()).toBeVisible();

      await anon.getByLabel(/^Full name/).fill('Anna Kovalenko');
      await anon.getByLabel(/^Order number/).fill('FB-123456');
      await anon.getByLabel(/^Email address/).fill('anna@example.com');
      await anon.getByLabel(/^How many forms/).fill('12');
      await anon.locator('.fb-scale__item', { hasText: '4' }).click();
      await anon.getByText('Editor', { exact: true }).click();
      await anon.getByText('Export, CSV').click();
      await anon.getByText('Friend').click();
      await anon.getByLabel(/^Start date/).fill('2025-03-14');
      await anon.getByLabel(/^Country/).selectOption('Ukraine');
      await anon.getByLabel(/^Comments/).fill('Quotes "here", comma, and\nnew line; =1+1');
      await anon.getByRole('button', { name: 'Submit' }).click();
      await expect(anon.getByRole('heading', { name: 'Response submitted' })).toBeVisible();
      await expect(anon.getByText('Thanks! Your response has been recorded.')).toBeVisible();

      // 5. draft edit doesn't change the live form
      await selectBlock(page, 'Full name');
      const p = await openProps(page);
      await expect(p.locator('#p-label')).toHaveValue('Full name');
      await p.locator('#p-label').fill('Your full name');
      await closeProps(page);
      await saved(page);
      await expect(page.locator('.fb-badge--unpublished:visible').first()).toBeVisible();
      await anon.goto(link);
      await expect(anon.getByLabel(/^Full name/)).toBeVisible();
      await expect(anon.getByText('Your full name')).toHaveCount(0);

      // 6. publish v2 without "Order number" (delete with the undo toast)
      await page.locator('.fb-block', { hasText: 'Order number' }).getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('Field deleted')).toBeVisible();
      await page.getByRole('button', { name: 'Undo' }).click();
      await expect(page.locator('.fb-block', { hasText: 'Order number' })).toHaveCount(1);
      await page.locator('.fb-block', { hasText: 'Order number' }).getByRole('button', { name: 'Delete' }).click();
      await expect(page.locator('.fb-block', { hasText: 'Order number' })).toHaveCount(0);
      await saved(page);
      await publish(page, false, 2);

      // 7. answer v2
      await anon.goto(link);
      await expect(anon.getByLabel(/^Your full name/)).toBeVisible();
      await expect(anon.getByLabel(/^Order number/)).toHaveCount(0);
      await anon.getByLabel(/^Your full name/).fill('Bob Stone');
      await anon.getByLabel(/^Email address/).fill('bob@example.com');
      await anon.locator('.fb-scale__item', { hasText: '5' }).click();
      await anon.getByText('Links', { exact: true }).click();
      await anon.getByLabel(/^Country/).selectOption('Canada');
      await anon.getByLabel(/^Comments/).fill('=1+1');
      await anon.getByRole('button', { name: 'Submit' }).click();
      await expect(anon.getByRole('heading', { name: 'Response submitted' })).toBeVisible();

      // 8. responses table + v1 / v2 details
      const formUrl = page.url().replace(/\/edit$/, '');
      await page.goto(formUrl + '/responses');
      await expect(page.locator('.resp-summary__count')).toContainText('2 responses');
      const rows = page.locator('.resp-table tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText('#2');
      await expect(rows.nth(0)).toContainText('v2');
      await expect(rows.nth(1)).toContainText('v1');
      await rows.nth(1).getByRole('link', { name: /View response #1/ }).click();
      await expect(page.getByRole('heading', { name: 'Response #1' })).toBeVisible();
      await expect(page.getByText('Submitted to version 1.')).toBeVisible();
      const removed = page.locator('.rd-answer--removed');
      await expect(removed).toContainText('Order number');
      await expect(removed).toContainText('Removed in v2');
      await expect(removed).toContainText('FB-123456');
      await expect(page.locator('.rd-answer', { hasText: 'Full name' }).first()).toContainText('Anna Kovalenko');
      await expect(page.locator('.rd-long')).toContainText('new line; =1+1');
      await page.getByRole('link', { name: 'Newer response' }).click();
      await expect(page.getByRole('heading', { name: 'Response #2' })).toBeVisible();
      await expect(page.locator('.rd-answer', { hasText: 'Your full name' })).toContainText('Bob Stone');
      await expect(page.locator('.rd-answer--removed')).toHaveCount(0);

      // 9. close and reopen
      await page.goto(formUrl + '/edit');
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: 'Close responses' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Close responses' }).click();
      await expect(page.getByText('Responses are closed.').first()).toBeVisible();
      await anon.goto(link);
      await expect(anon.getByRole('heading', { name: 'This form is no longer accepting responses' })).toBeVisible();
      await page.locator('.fb-banner').getByRole('button', { name: 'Reopen responses' }).click();
      await expect(page.getByText('Responses reopened')).toBeVisible();
      await anon.goto(link);
      await expect(anon.getByRole('button', { name: 'Submit' })).toBeVisible();

      // 10. CSV export
      await page.goto(formUrl + '/responses');
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
      const csv = await (await download.createReadStream()).toArray();
      const text = Buffer.concat(csv).toString('utf8');
      expect(text.charCodeAt(0)).toBe(0xfeff);
      writeFileSync(fileURLToPath(new URL(`../../docs/samples/e2e-export-${vp.name}.csv`, import.meta.url)), text);
      const header = text.slice(1).split('\r\n')[0];
      expect(header).toBe('Response,Submitted (UTC),Version,Your full name,Email address,How satisfied are you?,Features,Source,How many forms?,Start date,Country,Comments,Order number');
      expect(text).toContain('"Quotes ""here"", comma, and\nnew line; =1+1"');
      expect(text).toContain('"Editor; Export, CSV"');
      expect(text).toContain(",'=1+1,"); // formula injection neutralised (value starts with =)

      // 11. delete a response, then the form
      await page.locator('.resp-table tbody tr').first().getByRole('button', { name: /More actions/ }).click();
      await page.getByRole('menuitem', { name: 'Delete…' }).click();
      await page.locator('dialog[open]').getByRole('button', { name: 'Delete response' }).click();
      await expect(page.getByText('Response #2 was permanently deleted.')).toBeVisible();
      await expect(page.locator('.resp-table tbody tr')).toHaveCount(1);

      await page.goto('/forms');
      const row = page.locator('tr', { hasText: title });
      await row.getByRole('button', { name: `Actions for ${title}` }).click();
      await page.getByRole('menuitem', { name: 'Delete…' }).click();
      await expect(page.locator('dialog[open]')).toContainText('and its 1 response');
      await page.locator('dialog[open]').getByRole('button', { name: 'Delete form' }).click();
      await expect(page.getByRole('heading', { name: 'No forms yet' })).toBeVisible();
      await anon.goto(link);
      await expect(anon.getByRole('heading', { name: 'Form not available' })).toBeVisible();
      await anon.context().close();
    });
  });
}

/** Adds a block and edits it in the properties panel. */
async function configure(page: Page, type: string, edit: (panel: import('@playwright/test').Locator) => Promise<void>): Promise<void> {
  await addBlock(page, type);
  const p = await openProps(page);
  await edit(p);
  await closeProps(page);
}

async function publish(page: Page, first: boolean, version: number): Promise<string> {
  const label = first ? 'Publish' : 'Publish changes';
  await page.locator('#ed-publish').click();
  const dlg = page.locator('dialog[open]');
  await expect(dlg.getByRole('heading')).toHaveText(first ? 'Publish form?' : 'Publish changes?');
  await dlg.getByRole('button', { name: label, exact: true }).click();
  const done = page.locator('dialog[open]');
  await expect(done.getByRole('heading')).toHaveText(`Form published — version ${version} is live`);
  const link = await done.locator('#dlg-published-link').inputValue();
  await done.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('.fb-badge--published:visible').first()).toContainText(`v${version}`);
  return link;
}

async function respondent(browser: Browser, vp: { width: number; height: number; name: string }): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.name === 'mobile', hasTouch: vp.name === 'mobile' });
  return ctx.newPage();
}

void isMobile;
