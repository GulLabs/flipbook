import { chromium } from '/Users/atifgul/.claude/skills/playwright-skill/node_modules/playwright/index.mjs';
const browser = await chromium.launch();
const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto('http://localhost:3601/books/cinders-paw-band/read?spread=3', {
  waitUntil: 'networkidle',
});
await p.waitForTimeout(2500);
await p.keyboard.press('ArrowRight');
await p.waitForTimeout(350);
const r = await p.evaluate(() => {
  const items = [...document.querySelectorAll('.stf__item')];
  const moving = items.filter(
    (el) =>
      getComputedStyle(el).transform !== 'none' && getComputedStyle(el).visibility === 'visible',
  );
  return moving.map((el) => {
    const cs = getComputedStyle(el);
    const kids = [...el.querySelectorAll('*')].slice(0, 6).map((k) => {
      const kc = getComputedStyle(k);
      return {
        tag: k.tagName,
        cls: k.className.toString().slice(0, 50),
        bg: kc.backgroundColor,
        opacity: kc.opacity,
        visibility: kc.visibility,
      };
    });
    return {
      cls: el.className.toString(),
      transform: cs.transform.slice(0, 60),
      clipPath: cs.clipPath.slice(0, 60),
      transformStyle: cs.transformStyle,
      before: {
        bg: getComputedStyle(el, '::before').backgroundColor,
        bgImage: getComputedStyle(el, '::before').backgroundImage.slice(0, 80),
        z: getComputedStyle(el, '::before').zIndex,
      },
      kids,
    };
  });
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
