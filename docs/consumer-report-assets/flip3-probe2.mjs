import { chromium } from '/Users/atifgul/.claude/skills/playwright-skill/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3601/books/cinders-paw-band/read?spread=3', {
  waitUntil: 'networkidle',
});
await p.waitForTimeout(2500);
const r = await p.evaluate(() => {
  const parent = document.querySelector('.stf__parent');
  const item = document.querySelector('.stf__item');
  const inner = item?.firstElementChild;
  const injected = [...document.querySelectorAll('style')]
    .map((s) => s.textContent)
    .filter((t) => t?.includes('stf'));
  return {
    paperVarOnParent: parent ? getComputedStyle(parent).getPropertyValue('--stf-paper') : null,
    itemBefore: item ? getComputedStyle(item, '::before').backgroundColor : null,
    itemBeforeContent: item ? getComputedStyle(item, '::before').content : null,
    innerCls: inner?.className?.toString().slice(0, 80),
    innerBg: inner ? getComputedStyle(inner).backgroundColor : null,
    stfStyleCount: injected.length,
    stfStyleSample: injected[0]?.slice(0, 600) ?? 'NONE',
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
