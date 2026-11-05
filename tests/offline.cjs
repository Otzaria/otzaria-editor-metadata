"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const results = path.join(root, "test-results");
const source = [
  {
    title: "פריט לדוגמה", id: 12, active: true, tags: ["א", "ב"],
    description: "תיאור ארוך לצורך בדיקת הממשק בלבד ובחינת שדות טקסט ללא רשת.",
  },
  { title: "פריט נוסף", id: 13, active: false },
];
const fixture = {
  name: "sample.json", mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(source)),
};

function checkNoSessionBootstrap(html) {
  // Check booleans rather than asserting on the HTML itself: a regression must
  // fail without printing embedded session values into a test log.
  for (const name of ["__initial_auth_token", "__firebase_config", "__app_id"]) {
    assert.equal(html.includes(name), false, `Unexpected hosted bootstrap global: ${name}`);
  }
  assert.equal(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(html), false,
    "Unexpected embedded session-token pattern");
  assert.equal(/\bAIza[0-9A-Za-z_-]{35}\b/.test(html), false,
    "Unexpected embedded hosted-service configuration");
}

async function importAndSelect(page) {
  await page.locator("#file-input").setInputFiles(fixture);
  await page.locator("#item-0").click();
  await page.mouse.move(0, 0);
  await page.waitForFunction(() =>
    getComputedStyle(document.getElementById("item-0")).backgroundColor === "rgb(191, 219, 254)");
}

async function dynamicStyles(page) {
  return page.evaluate(() => {
    const item = getComputedStyle(document.getElementById("item-0"));
    const checkbox = getComputedStyle(document.querySelector("#edit-details input[type=checkbox]"));
    const field = getComputedStyle(document.querySelector("#edit-details input[type=text]"));
    const label = getComputedStyle(document.querySelector("#edit-details label"));
    return {
      selectedBackground: item.backgroundColor,
      cursor: item.cursor,
      checkboxWidth: checkbox.width,
      checkboxHeight: checkbox.height,
      fieldPadding: field.padding,
      fieldMarginTop: field.marginTop,
      labelWeight: label.fontWeight,
      mainWidth: getComputedStyle(document.querySelector("main")).width,
      direction: getComputedStyle(document.body).direction,
    };
  });
}

async function download(page, selector, filename) {
  const pending = page.waitForEvent("download");
  await page.locator(selector).click();
  const file = await pending;
  const destination = path.join(results, filename);
  await file.saveAs(destination);
  return { file, destination };
}

(async () => {
  await fs.mkdir(results, { recursive: true });
  checkNoSessionBootstrap(await fs.readFile(path.join(root, "index.html"), "utf8"));
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: process.env.CHROMIUM_ARGS ? JSON.parse(process.env.CHROMIUM_ARGS) : [],
  });
  try {
    const context = await browser.newContext({
      offline: true, acceptDownloads: true, viewport: { width: 1440, height: 1000 },
    });
    const requests = [];
    const errors = [];
    context.on("request", (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url());
    });
    context.on("page", (page) => {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
    });

    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(root, "index.html")).href);
    assert.equal(await page.locator("#editor-area").isHidden(), true);
    const fontFaces = await page.evaluate(async () => {
      await Promise.all([...document.fonts].map((face) => face.load()));
      return [...document.fonts].map((face) => ({ family: face.family, status: face.status }));
    });
    assert.equal(fontFaces.length, 7);
    assert.ok(fontFaces.every((face) => face.family === "Inter" && face.status === "loaded"));

    await importAndSelect(page);
    const styles = await dynamicStyles(page);
    assert.deepEqual(styles, {
      selectedBackground: "rgb(191, 219, 254)", cursor: "pointer",
      checkboxWidth: "20px", checkboxHeight: "20px", fieldPadding: "6px",
      fieldMarginTop: "4px", labelWeight: "500", mainWidth: "1000px", direction: "rtl",
    });
    await page.locator("#item-1").hover();
    await page.waitForFunction(() =>
      getComputedStyle(document.getElementById("item-1")).backgroundColor === "rgb(219, 234, 254)");
    await page.mouse.move(0, 0);
    await page.waitForFunction(() =>
      getComputedStyle(document.getElementById("item-1")).backgroundColor === "rgba(0, 0, 0, 0)");
    await page.screenshot({ path: path.join(results, "editor-offline.png"), fullPage: true });

    await page.locator("#edit-details input[type=text]").fill("כותרת חדשה");
    await page.locator("#edit-details input[type=number]").fill("42");
    await page.locator("#edit-details input[type=checkbox]").uncheck();
    await page.locator("#edit-details textarea[data-is-object]").fill('["ג","ד"]');
    await page.locator("#edit-details textarea:not([data-is-object])").fill("תיאור מעודכן");
    await page.locator("#search-input").fill("נוסף");
    assert.equal(await page.locator("#item-list li").count(), 1);
    assert.equal(await page.locator("#item-list li").getAttribute("id"), "item-1");

    // Saving while filtered must preserve all rows, their types and edits.
    const json = await download(page, "#save-button", "edited.json");
    assert.equal(json.file.suggestedFilename(), "sample.json");
    assert.deepEqual(JSON.parse(await fs.readFile(json.destination, "utf8")), [
      { title: "כותרת חדשה", id: 42, active: false, tags: ["ג", "ד"], description: "תיאור מעודכן" },
      source[1],
    ]);

    // The app download must reopen from a clean shell after editing/searching,
    // with all styles/fonts present and without stale catalog data or controls.
    const app = await download(page, 'button[onclick="downloadAppHtml()"]', "metadata_editor_offline.html");
    assert.equal(app.file.suggestedFilename(), "metadata_editor_offline.html");
    const exportedHtml = await fs.readFile(app.destination, "utf8");
    checkNoSessionBootstrap(exportedHtml);
    assert.ok(exportedHtml.includes('id="compiled-styles"'));
    assert.ok(exportedHtml.includes("data:font/woff2;base64,"));
    assert.ok(!exportedHtml.includes("כותרת חדשה"));
    assert.ok(!exportedHtml.includes("פריט לדוגמה"));
    const reopened = await context.newPage();
    await reopened.goto(pathToFileURL(app.destination).href);
    assert.equal(await reopened.locator("#editor-area").isHidden(), true);
    assert.equal(await reopened.locator("#item-count").textContent(), "0");
    await importAndSelect(reopened);
    assert.deepEqual(await dynamicStyles(reopened), styles);
    await reopened.locator("#edit-details input[type=number]").fill("44");
    const roundTrip = await download(reopened, "#save-button", "reopened-edited.json");
    assert.deepEqual(JSON.parse(await fs.readFile(roundTrip.destination, "utf8")), [
      { ...source[0], id: 44 }, source[1],
    ]);

    // Preserve the existing fixed-width layout on small screens.
    await reopened.setViewportSize({ width: 390, height: 844 });
    assert.equal((await dynamicStyles(reopened)).mainWidth, "1000px");
    assert.deepEqual(requests, []);
    assert.deepEqual(errors, []);
    const report = {
      externalRequests: requests, browserErrors: errors, embeddedFontFaces: fontFaces.length,
      embeddedSessionBootstrap: "absent in source and downloaded application",
      dynamicStyles: styles, jsonEditSearchExport: "passed", downloadedAppReimportAndExport: "passed",
      fixedWidthOnSmallViewport: "passed", browserVersion: browser.version(),
    };
    await fs.writeFile(path.join(results, "offline-qa.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
