import { chromium } from '/Users/atifgul/.claude/skills/playwright-skill/node_modules/playwright/index.mjs';
const out = process.cwd();
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3601/books/cinders-paw-band/read?spread=3', {
  waitUntil: 'networkidle',
});
await p.waitForTimeout(2500);
await p.keyboard.press('ArrowRight');
// burst: every ~90ms through the 800ms turn + landing
for (let i = 0; i < 14; i++) {
  await p.screenshot({ path: `${out}/burst-${String(i).padStart(2, '0')}.png` });
}
console.log('burst done');
await browser.close();
