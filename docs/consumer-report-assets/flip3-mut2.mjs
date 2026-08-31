import { chromium } from '/Users/atifgul/.claude/skills/playwright-skill/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3601/books/cinders-paw-band/read?spread=3', {
  waitUntil: 'networkidle',
});
await p.waitForTimeout(2500);
await p.evaluate(() => {
  window.__log = [];
  const t0 = performance.now();
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      if (r.type !== 'childList') continue;
      const name = (n) =>
        n.nodeType === 1
          ? `${n.tagName}.${(n.className?.toString() ?? '').slice(0, 45)}`
          : n.nodeName;
      window.__log.push({
        t: Math.round(performance.now() - t0),
        target: name(r.target),
        added: [...r.addedNodes].map(name),
        removed: [...r.removedNodes].map(name),
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
});
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(1600);
const log = await p.evaluate(() => window.__log.slice(0, 40));
console.log(JSON.stringify(log, null, 1));
await browser.close();
