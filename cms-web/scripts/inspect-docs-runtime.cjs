const { chromium } = require('playwright');

(async () => {
  const browser = await chromium
    .launch({ headless: true, channel: 'msedge' })
    .catch(async () => chromium.launch({ headless: true }));

  const page = await browser.newPage({ viewport: { width: 1536, height: 740 } });
  const logs = [];
  const errors = [];

  page.on('console', (msg) => {
    logs.push({ type: msg.type(), text: msg.text() });
  });

  page.on('pageerror', (err) => {
    errors.push(err.message);
  });

  page.on('requestfailed', (req) => {
    const failure = req.failure();
    errors.push(`REQFAIL ${req.url()} ${failure ? failure.errorText : 'unknown'}`);
  });

  await page.goto('http://127.0.0.1:4173/#/login', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });

  await page.screenshot({ path: 'playwright-login.png', fullPage: true });

  const state = await page.evaluate(() => ({
    title: document.title,
    url: location.href,
    bodyText: document.body.innerText.slice(0, 1000),
    buttons: Array.from(document.querySelectorAll('button')).map((button) => button.textContent?.trim()).filter(Boolean),
    inputs: Array.from(document.querySelectorAll('input')).map((input) => ({
      type: input.type,
      placeholder: input.placeholder,
      value: input.value,
    })),
  }));

  console.log(JSON.stringify({ state, logs, errors }, null, 2));
  await browser.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
