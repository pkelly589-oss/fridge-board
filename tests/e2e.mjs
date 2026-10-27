// End-to-end check of the phone page in a real browser, against the local
// Firebase emulators. Run with `npm run test:e2e`.
//
// It seeds a household and some items, signs in through the emulator's fake
// Google sign-in, and walks through the main features at phone size.
// Screenshots are written to test-results/ for a visual check.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const BASE = 'http://127.0.0.1:5000/';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-fridge-board/databases/(default)/documents';
const OWNER = 'pat.owner@example.com';
const STRANGER = 'stranger@example.com';
const H = 36e5, D = 864e5, now = Date.now();
mkdirSync('test-results', { recursive: true });

// ---- Seed data directly into the emulator, bypassing security rules -------
const ts = (ms) => ({ timestampValue: new Date(ms).toISOString() });
const str = (s) => (s == null ? { nullValue: null } : { stringValue: s });
async function put(path, fields) {
  const res = await fetch(`${FS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  assert.ok(res.ok, `seed ${path}: ${res.status} ${await res.text()}`);
}
async function seedItem(id, o) {
  await put(`items/${id}`, {
    list: str(o.list ?? 'fridge'), name: str(o.name), qty: str(o.qty ?? null),
    use_by: str(o.use_by ?? null), note: str(o.note ?? null),
    added_at: ts(o.added), added_by: str(OWNER),
    done_at: o.done ? ts(o.done) : { nullValue: null }, done_by: str(o.done ? OWNER : null),
    archived_at: { nullValue: null },
  });
}
const day = (offset) => {
  const d = new Date(now + offset * D);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

await fetch(`${FS}`.replace('/documents', '/documents'), { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
await put(`allowlist/${OWNER}`, { role: str('owner') });
await seedItem('leftovers', { name: 'Leftover curry', added: now - 9 * D });
await seedItem('yogurt', { name: 'Greek yogurt', qty: '2', use_by: day(1), added: now - 3 * D });
await seedItem('eggs', { name: 'Eggs', qty: '6', added: now - 1 * D });
await seedItem('milk-old', { name: 'Old milk (should archive)', added: now - 10 * D, done: now - 30 * H });
await seedItem('butter', { name: 'Butter', added: now - 5 * D, done: now - 2 * H });
await seedItem('tacos', { list: 'meals', name: 'Fish tacos', note: 'uses the cabbage', added: now - 4 * D });
await seedItem('soup', { list: 'meals', name: 'Lentil soup', added: now - 2 * D });

// ---- Browser ---------------------------------------------------------------
const browser = await chromium.launch({
  proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (name) => page.screenshot({ path: `test-results/${name}.png`, fullPage: true });

// Sign in through the auth emulator's fake Google page.
async function signIn(email) {
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#signin')]);
  await popup.waitForLoadState();
  await popup.getByText('Add new account').click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('Pat Owner');
  await popup.getByText('Sign in with Google.com').click();
}
const names = () => page.locator('.items .name').allTextContents();

// 1. A stranger is turned away.
await page.goto(BASE);
await page.waitForSelector('#view-signin:not([hidden])');
await shot('1-signin');
await signIn(STRANGER);
await page.waitForSelector('#view-denied:not([hidden])');
assert.equal(await page.textContent('#denied-email'), STRANGER);
await shot('2-denied');
await page.click('#denied-signout');
await page.waitForSelector('#view-signin:not([hidden])');

// 2. The owner gets in and sees the fridge oldest first, done items last.
await signIn(OWNER);
await page.waitForSelector('.items .name');
await page.waitForFunction(() => !document.getElementById('panel').textContent.includes('Old milk'));
assert.deepEqual(await names(), ['Leftover curry', 'Greek yogurt', 'Eggs', 'Butter']);
assert.match(await page.locator('.item', { hasText: 'Leftover curry' }).textContent(), /9d/);
assert.match(await page.locator('.item', { hasText: 'Greek yogurt' }).locator('.flag').textContent(), /Use by tomorrow/);
assert.ok(await page.locator('.item.done', { hasText: 'Butter' }).count());
await shot('3-fridge');

// 3. The item crossed off 30 hours ago was archived by the page.
const archived = await (await fetch(`${FS}/items/milk-old`, { headers: { Authorization: 'Bearer owner' } })).json();
assert.ok(archived.fields.archived_at.timestampValue, 'old item was archived');

// 4. Quick add, cross off, undo.
await page.fill('.add-input', 'Spinach');
await page.press('.add-input', 'Enter');
await page.fill('.add-input', 'Cheddar');
await page.press('.add-input', 'Enter');
await page.waitForFunction(() => document.querySelectorAll('.items .name').length === 6);
assert.deepEqual((await names()).slice(-3), ['Spinach', 'Cheddar', 'Butter']);
await page.locator('.item', { hasText: 'Eggs' }).locator('.check').click();
await page.waitForSelector('.item.done:has-text("Eggs")');
assert.deepEqual((await names()).slice(-2), ['Butter', 'Eggs']);
await page.locator('.item', { hasText: 'Eggs' }).locator('.check').click();
await page.waitForSelector('.item:not(.done):has-text("Eggs")');

// 4b. Text half-typed in the add box survives a change made by someone else.
await page.fill('.add-input', 'Half-typ');
await seedItem('remote', { name: 'Added on another phone', added: now - 1 * H });
await page.waitForSelector('.items .name:has-text("Added on another phone")');
assert.equal(await page.inputValue('.add-input'), 'Half-typ');
await page.fill('.add-input', '');
await fetch(`${FS}/items/remote`, { method: 'DELETE', headers: { Authorization: 'Bearer owner' } });
await page.waitForFunction(() => !document.getElementById('panel').textContent.includes('another phone'));

// 5. Edit: quantity, use-by date and backdating.
await page.locator('.item', { hasText: 'Spinach' }).locator('.body').click();
await page.waitForSelector('#edit[open]');
await shot('4-edit');
await page.fill('#edit [name=qty]', '1 bag');
await page.fill('#edit [name=use_by]', day(0));
await page.fill('#edit [name=added_on]', day(-12));
await page.click('#edit button[value=save]');
await page.waitForFunction(() => !document.getElementById('edit').open);
await page.waitForFunction(() => document.querySelector('.items .name')?.textContent === 'Spinach');
const spinach = await page.locator('.item', { hasText: 'Spinach' }).textContent();
assert.match(spinach, /1 bag/); assert.match(spinach, /12d/); assert.match(spinach, /Use by today/);

// 6. Delete needs two taps.
await page.locator('.item', { hasText: 'Cheddar' }).locator('.body').click();
await page.click('#edit-delete');
assert.equal(await page.textContent('#edit-delete'), 'Tap again to delete');
await page.click('#edit-delete');
await page.waitForFunction(() => !document.querySelector('.items')?.textContent.includes('Cheddar'));

// 7. Meals tab: order added, note shown, no age marker.
await page.click('.tab:has-text("Meals")');
await page.waitForSelector('h1:has-text("Meal ideas")');
assert.deepEqual(await names(), ['Fish tacos', 'Lentil soup']);
assert.match(await page.locator('.item', { hasText: 'Fish tacos' }).textContent(), /uses the cabbage/);
await shot('5-meals');

// 8. Archive tab shows the archived item and can restore it.
await page.click('.tab:has-text("Archive")');
await page.waitForSelector('.items .name:has-text("Old milk")');
await shot('6-archive');
await page.click('.item:has-text("Old milk") button:has-text("Restore")');
await page.waitForFunction(() => !document.querySelector('.items .name'));

// 9. Household tab: add and remove a member; the owner can't remove themselves.
await page.click('.tab:has-text("People")');
await page.waitForSelector(`.items .name:has-text("${OWNER}")`);
await page.fill('#panel input[type=email]', 'Partner@Example.com');
await page.press('#panel input[type=email]', 'Enter');
await page.waitForSelector('.items .name:has-text("partner@example.com")');
assert.equal(await page.locator(`.item:has-text("${OWNER}") button`).count(), 0);
await shot('7-household');
const row = page.locator('.item:has-text("partner@example.com")');
await row.locator('button').click();
await row.locator('button:has-text("Confirm")').click();
await page.waitForFunction(() => !document.getElementById('panel').textContent.includes('partner@example.com'));

// 10. Dark mode render of the fridge list.
await page.click('.tab:has-text("Fridge")');
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForTimeout(300);
await shot('8-fridge-dark');

assert.deepEqual(errors, [], `page errors: ${errors.join('; ')}`);
await browser.close();
console.log('E2E: all checks passed');
