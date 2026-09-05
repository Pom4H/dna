/** Browser regression for an already running local company-network demo.
 *
 * Requires externally provided Playwright; adds no repository dependency.
 *   DNA_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/company-network-browser.mjs
 * Optional:
 *   DNA_DEMO_URL=http://localhost:3117
 *   DNA_BROWSER_CHANNEL=chrome     ("bundled" uses Playwright's Chromium)
 *   DNA_BROWSER_OUTPUT=/tmp/dna-network-browser  (empty or "none" disables screenshots)
 *
 * Creates two fictional sessions through the UI. Does not restart the server.
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.DNA_PLAYWRIGHT_MODULE ?? "playwright");
const baseURL = process.env.DNA_DEMO_URL ?? "http://localhost:3117";
const channel = process.env.DNA_BROWSER_CHANNEL ?? "chrome";
const configuredOutput = process.env.DNA_BROWSER_OUTPUT ?? "/tmp/dna-network-browser";
const outputDirectory = configuredOutput && configuredOutput !== "none" ? resolve(configuredOutput) : null;
const timeout = 35_000;

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: timed out after ${timeout} ms`)), timeout);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  if (outputDirectory) await mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true, timeout,
    ...(channel === "bundled" ? {} : { channel }) });
  let page;
  let releaseOldResponse;
  const screenshots = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    context.setDefaultTimeout(timeout);
    context.setDefaultNavigationTimeout(timeout);
    page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    const screenshot = async name => {
      if (!outputDirectory) return;
      const path = join(outputDirectory, `${name}.png`);
      await page.screenshot({ path, fullPage: true, timeout });
      screenshots.push(path);
    };

    await page.goto(baseURL);
    await page.locator("#scenario").selectOption("baseline");
    await page.locator("#fault").uncheck();
    await page.locator("#start").click();
    await page.waitForFunction(() => Boolean(localStorage.getItem("dna-session")) &&
      !document.querySelector("#start").disabled, undefined, { timeout });
    const firstId = await page.evaluate(() => localStorage.getItem("dna-session"));
    assert.ok(firstId, "The first UI-created session must have an identity");
    assert.equal(await page.locator(".company").count(), 3);
    console.log("PASS: fresh browser context created its own first three-company session");

    let capturedResolve;
    let releasedResolve;
    let once = true;
    const held = new Promise(resolve => { releaseOldResponse = resolve; });
    const captured = new Promise(resolve => { capturedResolve = resolve; });
    const fulfilled = new Promise(resolve => { releasedResolve = resolve; });
    await page.route("**/api/state*", async route => {
      const requested = new URL(route.request().url());
      if (!once || route.request().method() !== "GET" || requested.searchParams.get("sessionId") !== firstId) {
        await route.continue();
        return;
      }
      once = false;
      // Capture the old response before starting a new session, just as in the
      // original red-to-green browser reproduction. Deliver its bytes later.
      const response = await route.fetch({ timeout });
      capturedResolve();
      await held;
      await route.fulfill({ response });
      releasedResolve();
    });
    await within(captured, "Capture old session GET");
    await page.locator("#start").click();
    await page.waitForFunction(previousId => {
      const nextId = localStorage.getItem("dna-session");
      return nextId && nextId !== previousId && !document.querySelector("#start").disabled;
    }, firstId, { timeout });
    const newId = await page.evaluate(() => localStorage.getItem("dna-session"));
    assert.ok(newId && newId !== firstId, "The second UI action must create a distinct session");
    releaseOldResponse();
    await within(fulfilled, "Deliver delayed old session response");
    // Observe immediately after the stale response, before a later normal poll
    // could repair the old bug and conceal the regression.
    await page.waitForTimeout(150);
    const label = await page.locator("#session-label").textContent();
    assert.ok(label.includes(newId.slice(0, 8).toUpperCase()),
      `Stale GET replaced the new session ${newId}: ${label}`);
    await page.unroute("**/api/state*");
    console.log("PASS: delayed old GET cannot overwrite a newly created agreement");

    await page.locator('[data-action="accept"]').click({ timeout });
    await page.waitForFunction(() => {
      const button = document.querySelector('[data-action="feedback"]');
      return button && !button.disabled;
    }, undefined, { timeout });
    await page.locator('[data-action="feedback"]').click();
    await page.waitForFunction(() => document.querySelector("#feedback-result").textContent.includes("Экспорт"),
      undefined, { timeout });
    await page.waitForFunction(() => document.querySelector("#run-count").textContent.trim() === "04",
      undefined, { timeout });
    console.log("PASS: installation, explicit acceptance, activation and feedback produce four workflow runs");

    await page.locator('[data-tab="evolution"]').click();
    await page.waitForSelector(".candidate", { timeout });
    assert.equal(await page.locator(".candidate").count(), 7);
    assert.equal(await page.locator(".candidate.best").count(), 1);
    assert.match(await page.locator(".candidate.best").innerText(), /1[\s\u00a0]?700\s*EUR/u);
    await screenshot("evolution-desktop-dark");
    console.log("PASS: seven finite candidates and the EUR 1 700 best feasible contribution are visible");

    await page.locator('[data-tab="passport"]').click();
    const chip = page.locator(".passport-row").filter({ hasText: "UID чипа" });
    await chip.waitFor({ state: "visible" });
    assert.equal(await chip.count(), 1);
    assert.ok((await chip.innerText()).includes(`DEMO-CHIP-UID-${newId}`), "Passport chip must belong to the current session");
    assert.match(await page.locator("#inspector-content h4").innerText(), /История привязок\s*·\s*4/u);
    assert.equal(await page.locator(".passport-row details").count(), 4);
    const receiptIds = await page.locator(".passport-row details code").evaluateAll(nodes =>
      nodes.map(node => node.firstChild?.textContent?.trim() ?? ""));
    assert.equal(new Set(receiptIds).size, 4, "The four passport bindings must reference distinct receipts");
    assert.ok(receiptIds.every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)),
      "Passport binding receipt IDs must remain visible in their detail elements");
    await screenshot("passport-desktop-dark");
    console.log("PASS: current-session chip identity and four receipt-backed passport bindings are visible");

    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    await page.locator("#theme").click();
    await page.waitForTimeout(250); // Let the 200 ms color transition finish before screenshots.
    assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
    await page.locator('button[data-shell="workspace"]').click();
    assert.equal(await page.locator(".network-canvas.workspace .company").count(), 3);
    await screenshot("workspace-desktop-light");
    console.log("PASS: light theme and workspace shell retain the three subjects");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('button[data-shell="network"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true,
      "Mobile viewport must not have horizontal document overflow");
    const bounds = await page.locator(".company").evaluateAll(nodes => nodes.map(node => {
      const card = node.getBoundingClientRect(), container = node.parentElement.getBoundingClientRect();
      const tolerance = 1;
      return { id: node.getAttribute("data-subject"),
        inside: card.left >= container.left - tolerance && card.right <= container.right + tolerance &&
          card.top >= container.top - tolerance && card.bottom <= container.bottom + tolerance,
        card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom },
        container: { left: container.left, right: container.right, top: container.top, bottom: container.bottom } };
    }));
    assert.equal(bounds.length, 3);
    assert.ok(bounds.every(card => card.inside), `Mobile subject cards exceed their canvas: ${JSON.stringify(bounds)}`);
    await screenshot("network-mobile-light");
    assert.deepEqual(pageErrors, [], "Browser JavaScript errors must be absent");
    console.log("PASS: mobile document and subject card bounds are valid; no browser JavaScript errors");
    console.log(JSON.stringify({ status: "passed", baseURL, firstSessionId: firstId, currentSessionId: newId,
      workflowRuns: 4, candidates: 7, passportBindings: 4, shells: 2, themes: 2, bounds, screenshots }, null, 2));
  } catch (error) {
    if (page && outputDirectory && !page.isClosed()) {
      try { await page.screenshot({ path: join(outputDirectory, "failure.png"), fullPage: true, timeout: 5_000 }); }
      catch { /* Preserve the original assertion or browser failure. */ }
    }
    throw error;
  } finally {
    releaseOldResponse?.();
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
