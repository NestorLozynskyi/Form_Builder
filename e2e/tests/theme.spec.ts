import { expect, Page, test } from '@playwright/test';
import { signUp } from './helpers';

const bg = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).backgroundColor);
const color = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).color);

/** Theme follows the system, cycles light → dark → system, persists, and a live switch equals a fresh load. */
test('theme toggle: system default, cycle, persistence and live switch = fresh load', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await signUp(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system');

  const toggle = page.locator('[data-action="toggle-theme"]');
  await toggle.click(); // system -> light
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'light');
  expect(await bg(page, 'body')).toBe('rgb(246, 247, 249)');
  const live = { nav: await color(page, '.fb-nav__link'), btn: await bg(page, '.fb-page-header .fb-btn--primary, .fb-empty .fb-btn--primary') };

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect({ nav: await color(page, '.fb-nav__link'), btn: await bg(page, '.fb-page-header .fb-btn--primary, .fb-empty .fb-btn--primary') }).toEqual(live);

  await toggle.click(); // light -> dark
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg(page, 'body')).toBe('rgb(14, 16, 20)');
  const darkLive = await bg(page, '.fb-header');
  await page.reload();
  expect(await bg(page, '.fb-header')).toBe(darkLive);

  await toggle.click(); // dark -> system (dark media)
  await expect(page.locator('html')).toHaveAttribute('data-theme-pref', 'system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
