import { chromium } from '/Users/atifgul/.claude/skills/playwright-skill/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3601/books/cinders-paw-band/read?spread=3', {
  waitUntil: 'networkidle',
});
await p.waitForTimeout(2500);
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(300); // mid-turn
const probe = await p.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[class*="stf"], [data-density]')) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    out.push({
      cls: el.className.toString().slice(0, 60),
      density: el.getAttribute('data-density'),
      opacity: cs.opacity,
      bg: cs.backgroundColor,
      zIndex: cs.zIndex,
      transform: cs.transform === 'none' ? 'none' : 'yes',
      clipPath: cs.clipPath === 'none' ? 'none' : cs.clipPath.slice(0, 40),
    });
  }
  return out;
});
console.log(JSON.stringify(probe, null, 1));
await browser.close();
