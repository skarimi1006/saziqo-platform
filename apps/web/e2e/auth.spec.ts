/**
 * Auth e2e tests.
 *
 * Prerequisites:
 *   - Web server running on http://localhost:3000  (started by webServer in playwright.config.ts)
 *   - API server running on http://localhost:3001 with NODE_ENV=test
 *     (so OTP service stores plain codes in otp:test:{phone} Redis keys)
 *
 * Test phone: 09901000001  (E.164: +989901000001)
 * Uses GET /api/v1/_test/last-otp/:phone to retrieve the generated OTP.
 */
import { expect, test } from '@playwright/test';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001/api/v1';
const PHONE_LOCAL = '09901000001';
const PHONE_E164 = '+989901000001';
// Valid Iranian national ID for profile completion (passes checksum)
const TEST_NATIONAL_ID = '0123456789';
const TEST_EMAIL = 'e2e-test@saziqo.test';

// ─── helpers ────────────────────────────────────────────────────────────────

async function fetchLastOtp(phone: string): Promise<string> {
  const res = await fetch(`${API_BASE}/_test/last-otp/${encodeURIComponent(phone)}`);
  if (!res.ok) {
    throw new Error(
      `GET /_test/last-otp returned ${res.status}. Is the API running with NODE_ENV=test?`,
    );
  }
  const body = (await res.json()) as { data: { code: string } };
  return body.data.code;
}

/** Submit the phone form and land on the verify page. */
async function requestOtp(page: import('@playwright/test').Page, phone: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('شماره موبایل').fill(phone);
  await page.getByRole('button', { name: 'دریافت کد تأیید' }).click();
  await page.waitForURL(/\/login\/verify/);
}

/** Type OTP into the InputOTP widget. */
async function fillOtp(page: import('@playwright/test').Page, code: string): Promise<void> {
  // input-otp renders a single hidden <input data-input-otp> that drives all slots.
  const otpInput = page.locator('[data-input-otp]');
  await otpInput.focus();
  await page.keyboard.type(code);
}

/** Complete the profile form shown to new users. */
async function completeProfile(page: import('@playwright/test').Page): Promise<void> {
  await page.getByLabel('نام').fill('تست');
  await page.getByLabel('نام خانوادگی').fill('کاربر');
  await page.getByLabel('کد ملی').fill(TEST_NATIONAL_ID);
  await page.getByLabel('ایمیل').fill(TEST_EMAIL);
  await page.getByRole('button', { name: 'ذخیره و ادامه' }).click();
  await page.waitForURL(/\/dashboard/);
}

/**
 * Full login flow: OTP request → OTP verify → optional profile completion → dashboard.
 * Idempotent: if user is already ACTIVE the onboarding step is skipped.
 */
async function login(page: import('@playwright/test').Page): Promise<void> {
  await requestOtp(page, PHONE_LOCAL);

  const code = await fetchLastOtp(PHONE_E164);
  await fillOtp(page, code);

  // Wait for either the dashboard or the onboarding step (new user)
  await page.waitForURL(/\/(dashboard|onboarding\/profile)/);

  if (page.url().includes('/onboarding/profile')) {
    await completeProfile(page);
  }
}

// ─── tests ──────────────────────────────────────────────────────────────────

test.describe('auth flow', () => {
  test('test 1 — full OTP login lands on dashboard with welcome heading', async ({ page }) => {
    await login(page);

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('خوش آمدید');
  });

  test('test 2 — logout redirects to /login', async ({ page }) => {
    await login(page);

    // Open user menu (avatar button in the app shell header)
    await page.locator('button.rounded-full').click();
    await page.getByRole('menuitem', { name: 'خروج' }).click();

    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('ورود');
  });

  test('test 3 — page reload preserves session (refresh cookie)', async ({ page }) => {
    await login(page);

    await page.reload();

    // Auth bootstrap exchanges the httpOnly refresh cookie for a new access token.
    // If the session is valid the app stays on /dashboard, not redirecting to /login.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('خوش آمدید');
  });
});
