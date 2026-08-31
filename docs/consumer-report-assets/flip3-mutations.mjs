import { chromium } from '/Users/atifgul/.claude/skills/playwright-skill/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3601/books/cinders-paw-band/read?spread=3', {
  waitUntil: 'networkidle',
});
await p.waitForTimeout(2500);
await p.evaluate(() => {
  window.__muts = [];
  const t0 = performance.now();
  const mo = new MutationObserver((recs) => {
    for (const r of recs) {
      window.__muts.push({
        t: Math.round(performance.now() - t0),
        type: r.type,
        target: (r.target.className || r.target.nodeName || '').toString().slice(0, 40),
        added: r.addedNodes.length,
        removed: r.removedNodes.length,
        attr: r.attributeName,
      });
    }
  });
  mo.observe(document.querySelector('.stf__block'), {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
});
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(1600);
const muts = await p.evaluate(() => {
  const m = window.__muts;
  // summarize: bucket by 100ms, count childList add/removes vs attr churn
  const buckets = {};
  for (const x of m) {
    const b = Math.floor(x.t / 100) * 100;
    buckets[b] ??= { attr: 0, addRem: 0, targets: new Set() };
    if (x.type === 'childList') {
      buckets[b].addRem += x.added + x.removed;
      buckets[b].targets.add(x.target);
    } else buckets[b].attr++;
  }
  return Object.entries(buckets).map(([t, v]) => ({
    t: +t,
    attr: v.attr,
    addRem: v.addRem,
    targets: [...v.targets].slice(0, 3),
  }));
});
console.log(JSON.stringify(muts, null, 1));
await browser.close();
