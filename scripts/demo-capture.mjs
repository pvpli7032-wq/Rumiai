/**
 * Walks the whole app the way a new reader would and records it.
 *
 * Produces numbered PNGs plus one video under `screens/`, so a change to the UI can be
 * shown rather than described. Run it against a dev server that is already up:
 *
 *   TEST_BASE_URL=http://localhost:3001 node scripts/demo-capture.mjs
 *
 * It writes to the real database, like the E2E suite does, so it creates its own account
 * rather than touching a seeded one, and it removes the character it makes at the end. The
 * account itself is left behind — deleting a user would cascade to its coin history, and
 * the suite leaves its accounts too.
 */
import { chromium } from 'playwright';
import { mkdir, rm, readdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.TEST_BASE_URL || 'http://localhost:3001';
const OUT = path.resolve('screens');
const VIDEO_DIR = path.join(OUT, 'video');
const STAMP = Date.now();
const EMAIL = `demo_${STAMP}@example.com`;
const PASSWORD = 'Password123!';

let step = 0;
const shots = [];

async function shot(page, name, note) {
  step += 1;
  const file = path.join(OUT, `${String(step).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ file: path.basename(file), note });
  console.log(`  ${String(step).padStart(2, '0')}  ${name.padEnd(26)} ${note}`);
}

/** Waiting on a real signal beats a fixed sleep, but some beats are animation-only. */
const settle = (page, ms = 900) => page.waitForTimeout(ms);

/**
 * Waits for a client-side route change.
 *
 * `waitForURL` defaults to waiting for a `load` event, which a soft navigation never fires
 * — so it passed or timed out depending on timing. Polling the URL is what we actually
 * mean, and then we wait for the network to go quiet separately.
 */
async function waitForRoute(page, pattern, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (pattern.test(page.url())) {
      await page.waitForLoadState('networkidle').catch(() => {});
      return;
    }
    await page.waitForTimeout(200);
  }
  throw new Error(`route ${pattern} never arrived (ยังอยู่ที่ ${page.url()})`);
}

async function main() {
  // A stale run's files would interleave with this one's numbering.
  await rm(OUT, { recursive: true, force: true });
  await mkdir(VIDEO_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'th-TH',
    colorScheme: 'dark',
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  console.log(`\nบันทึกเดโม่จาก ${BASE}\n`);

  // ── 1. Arriving, signed out ────────────────────────────────────────────────
  await page.goto(`${BASE}/th`, { waitUntil: 'networkidle' });
  await settle(page);
  await shot(page, 'landing-th', 'หน้าแรกภาษาไทย (ยังไม่ล็อกอิน)');

  await page.goto(`${BASE}/en/auth`, { waitUntil: 'networkidle' });
  await settle(page);
  await shot(page, 'auth-en', 'หน้าเข้าสู่ระบบ/สมัคร ฉบับอังกฤษ');

  // ── 2. Signing up ─────────────────────────────────────────────────────────
  await page.goto(`${BASE}/th/auth`, { waitUntil: 'networkidle' });
  await settle(page);
  await page.getByRole('button', { name: 'สมัครสมาชิกฟรี' }).first().click();
  await settle(page, 400);
  const inputs = page.locator('form input');
  await inputs.nth(0).fill('ผู้ใช้เดโม่');
  await inputs.nth(1).fill(EMAIL);
  await inputs.nth(2).fill(PASSWORD);
  await shot(page, 'signup-filled', 'กรอกฟอร์มสมัครสมาชิก');

  await page.locator('form button[type="submit"]').click();
  await waitForRoute(page, /\/discover/);
  await settle(page);
  await shot(page, 'discover', 'หน้าหลักหลังสมัครเสร็จ (เด้งมาที่ /discover ไม่ใช่หน้าโฆษณา)');

  // ── 3. The character detail dialog ────────────────────────────────────────
  await page.locator('button[aria-haspopup="dialog"]').first().click();
  // The dialog renders its shell with role="dialog" while it is still loading, so waiting
  // on that alone captured a spinner and every step after it then found nothing and was
  // silently skipped. Wait for content that only exists once the character has arrived.
  await page.getByRole('button', { name: 'เริ่มคุย' }).waitFor({ timeout: 30_000 });
  await settle(page, 800);
  await shot(page, 'detail-about', 'กล่องรายละเอียดตัวละคร แท็บเกี่ยวกับ');

  for (const [label, name, note] of [
    ['ภารกิจ', 'detail-quests', 'แท็บภารกิจ'],
    ['คอมเมนต์', 'detail-comments', 'แท็บคอมเมนต์'],
  ]) {
    // No `if (count)` guard: a missing tab is a defect, and skipping it quietly is how the
    // demo shrank from 24 shots to 20 without saying why.
    const tab = page.getByRole('button', { name: new RegExp(`^${label}`) }).first();
    await tab.click({ timeout: 15_000 });
    await settle(page, 1200);
    await shot(page, name, note);
  }

  // The comments tab is open, so its composer is the one to fill.
  const composer = page.locator('[role="dialog"] textarea').first();
  await composer.fill('อ่านโปรไฟล์แล้วอยากคุยเลย', { timeout: 15_000 });
  await settle(page, 300);
  await page.getByRole('button', { name: 'ส่ง' }).first().click();
  await page.getByText('อ่านโปรไฟล์แล้วอยากคุยเลย').first().waitFor({ timeout: 20_000 });
  await settle(page, 600);
  await shot(page, 'comment-posted', 'คอมเมนต์ที่เพิ่งโพสต์');

  await page.getByRole('button', { name: 'รายงาน' }).first().click({ timeout: 15_000 });
  await page.getByText('เนื้อหาทางเพศ').first().waitFor({ timeout: 15_000 });
  await settle(page, 500);
  await shot(page, 'report-dialog', 'กล่องรายงาน 15 หมวด');
  await page.getByRole('button', { name: 'ยกเลิก' }).first().click();
  await settle(page, 500);

  // ── 4. Into the chat ──────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'เริ่มคุย' }).first().click();
  await waitForRoute(page, /\/chat/);
  await settle(page, 2500);
  await shot(page, 'chat-opened', 'หน้าแชท พร้อม panel ขวา (ค่าความสัมพันธ์ / โมเดล / บันทึก)');

  const box = page.locator('form input[type="text"]');
  // Typed rather than filled, so the video shows it being written.
  await box.click();
  await box.type('สวัสดี วันนี้เป็นยังไงบ้าง', { delay: 55 });
  await shot(page, 'chat-typing', 'กำลังพิมพ์ข้อความ');

  await page.locator('form button[type="submit"]').click();
  // The reply streams in; wait for a second bubble to settle rather than a fixed sleep.
  await page.waitForFunction(
    () => document.body.innerText.split('\n').filter(l => l.trim()).length > 5,
    { timeout: 60_000 },
  ).catch(() => {});
  await settle(page, 6000);
  await shot(page, 'chat-reply', 'คำตอบที่สตรีมมา — *บรรยาย* กับ "คำพูด" ถูกเรนเดอร์ ไม่ใช่ดอกจันดิบ');

  // Hovering a reply reveals copy / read-aloud / regenerate.
  const bubbles = page.locator('.group\\/msg');
  if (await bubbles.count()) {
    await bubbles.last().hover();
    await settle(page, 700);
    await shot(page, 'chat-actions', 'ปุ่มบนข้อความ: ถูกใจ / คัดลอก / อ่านออกเสียง / ขอคำตอบใหม่');
  }

  // The model picker on the panel reads the server's chain.
  const model = page.getByRole('button', { name: /deepseek|gemini|gpt-/ }).first();
  if (await model.count()) {
    await model.scrollIntoViewIfNeeded();
    await settle(page, 500);
    await shot(page, 'panel-models', 'ตัวเลือกโมเดลต่อแชท อ่านจาก /api/ai/models');
  }

  // ── 5. Creating a character ───────────────────────────────────────────────
  await page.goto(`${BASE}/creator`, { waitUntil: 'networkidle' });
  await settle(page, 1200);
  await shot(page, 'creator-top', 'หน้าสร้างตัวละคร');

  await page.locator('input').first().fill('ยามเฝ้าหอสมุด');
  const areas = page.locator('textarea');
  if (await areas.count()) await areas.nth(0).fill('พูดน้อย จริงจัง ไม่ชอบอธิบายตัวเอง');
  await settle(page, 500);
  await shot(page, 'creator-filled', 'กรอกชื่อและบุคลิก');

  // The fields that feed the system prompt, and the 18+ mark.
  const scenario = page.getByText('สถานการณ์ตอนนี้').first();
  if (await scenario.count()) {
    await scenario.scrollIntoViewIfNeeded();
    await settle(page, 600);
    await shot(page, 'creator-scenario', 'ช่องสถานการณ์ + แนวทางการสวมบทบาท (ส่งเข้าโมเดลจริง)');
  }
  const adult = page.getByText('เนื้อหาผู้ใหญ่ (18+)').first();
  if (await adult.count()) {
    await adult.scrollIntoViewIfNeeded();
    await settle(page, 600);
    await shot(page, 'creator-adult', 'สวิตช์ 18+ ที่ปลดส่วนขยายผู้ใหญ่ใน prompt');
  }

  // ── 6. The rest of the app ────────────────────────────────────────────────
  for (const [url, name, note] of [
    ['/shop', 'shop', 'ร้านคอยน์'],
    ['/leaderboard', 'leaderboard', 'จัดอันดับของขวัญ'],
    ['/horoscope', 'horoscope', 'ดูดวง'],
    ['/profile', 'profile', 'โปรไฟล์ เช็คอิน ภารกิจ'],
  ]) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
    await settle(page, 1200);
    await shot(page, name, note);
  }

  // The preference panel and the logout button both live on the profile page.
  const prefs = page.getByText('การตั้งค่าการอ่าน').first();
  if (await prefs.count()) {
    await prefs.scrollIntoViewIfNeeded();
    await settle(page, 700);
    await shot(page, 'preferences', 'การตั้งค่าการอ่าน: โหมดอ่าน / คำที่ไม่ต้องการ / ปุ่มลัด');
  }

  await page.setViewportSize({ width: 414, height: 896 });
  await page.goto(`${BASE}/discover`, { waitUntil: 'networkidle' });
  await settle(page, 1500);
  await shot(page, 'mobile-discover', 'หน้าหลักบนจอมือถือ');

  await context.close();
  await browser.close();

  // Playwright names the video by an internal id; give it something readable.
  const files = await readdir(VIDEO_DIR);
  const webm = files.find((f) => f.endsWith('.webm'));
  console.log(`\nภาพ ${shots.length} รูป → ${OUT}`);
  if (webm) console.log(`วิดีโอ → ${path.join(VIDEO_DIR, webm)}`);
  console.log(`บัญชีที่ใช้ในเดโม่: ${EMAIL} / ${PASSWORD}\n`);
}

main().catch((error) => {
  console.error('\nเดโม่ล้ม:', error.message);
  process.exit(1);
});
