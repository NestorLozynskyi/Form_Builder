import { expect, Locator, Page } from '@playwright/test';

export const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) < 768;
export const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 1280) >= 1200;

export async function signUp(page: Page, email = `e2e-${uid()}@example.com`, password = 'Password-123'): Promise<string> {
  await page.goto('/sign-up');
  await page.locator('#su-email').fill(email);
  await page.locator('#su-password').fill(password);
  await page.locator('#su-confirm').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await page.waitForURL('**/forms');
  return email;
}

/** Adds a block from the palette (bottom sheet on mobile) and waits for the canvas to show it. */
export async function addBlock(page: Page, name: string): Promise<void> {
  const before = await page.locator('.fb-block').count();
  if (isMobile(page)) await page.locator('.ed-mobilebar').getByRole('button', { name: 'Add field' }).click();
  await page.locator('#ed-palette .fb-palette__item', { hasText: name }).first().click();
  await expect(page.locator('.fb-block')).toHaveCount(before + 1);
}

/** Makes the properties panel visible (drawer on tablet, bottom sheet on mobile). */
export async function openProps(page: Page): Promise<Locator> {
  const right = page.locator('#ed-right');
  if (!isDesktop(page) && !(await right.evaluate((e) => e.classList.contains('is-open')))) {
    if (isMobile(page)) await page.locator('.ed-mobilebar').getByRole('button', { name: 'Properties' }).click();
    else await page.getByRole('button', { name: 'Properties', exact: true }).click();
  }
  await expect(right).toBeVisible();
  return right;
}

export async function closeProps(page: Page): Promise<void> {
  if (isDesktop(page)) return;
  const btn = page.getByRole('button', { name: 'Close properties' });
  if (await btn.isVisible()) await btn.click();
}

export async function selectBlock(page: Page, label: string | RegExp): Promise<void> {
  await page.locator('.fb-block', { has: page.locator('.fb-block__body', { hasText: label }) }).first().locator('.fb-block__head').click();
}

/** Waits until autosave reports Saved. */
export async function saved(page: Page): Promise<void> {
  await expect(page.locator('.fb-save').first()).toHaveText(/Saved/, { timeout: 15000 });
}
