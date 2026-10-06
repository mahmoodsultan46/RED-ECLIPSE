#!/usr/bin/env node

import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36 stock-tracker/1.0";

const DEFAULT_IN_STOCK_KEYWORDS = [
  "add to cart",
  "add to bag",
  "buy now",
  "in stock",
  "available now",
  "available for pickup",
  "ship it",
];

const DEFAULT_OUT_OF_STOCK_KEYWORDS = [
  "out of stock",
  "sold out",
  "currently unavailable",
  "unavailable",
  "notify me",
  "coming soon",
];

const POSITIVE_STRUCTURED_AVAILABILITY = new Set([
  "instock",
  "limitedavailability",
  "preorder",
]);

const NEGATIVE_STRUCTURED_AVAILABILITY = new Set([
  "outofstock",
  "soldout",
  "discontinued",
  "backorder",
]);

const DEFAULT_NODE_MODULES_PATH =
  "/Users/mahmoudsultan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";

const DEFAULT_CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
];

function parseArgs(argv) {
  const args = {
    configPath: null,
    once: false,
    testDiscord: false,
    selfTest: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--once") {
      args.once = true;
    } else if (arg === "--test-discord") {
      args.testDiscord = true;
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "--config") {
      args.configPath = argv[index + 1];
      index += 1;
    } else if (!arg.startsWith("--") && !args.configPath) {
      args.configPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function timestamp() {
  return new Date().toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

async function readJson(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  return JSON.parse(contents);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(`${filePath}.tmp`, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(`${filePath}.tmp`, filePath);
}

async function loadState(statePath) {
  try {
    return await readJson(statePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return { products: {} };
    }
    throw error;
  }
}

function normalizeConfig(rawConfig, configPath) {
  const configDir = path.dirname(configPath);
  const configuredInterval = Number(rawConfig.checkIntervalSeconds);
  const checkIntervalSeconds = clampNumber(configuredInterval, 15, 5, 86400);

  if (Number.isFinite(configuredInterval) && configuredInterval < 5) {
    console.warn(
      `[${timestamp()}] checkIntervalSeconds was ${configuredInterval}; using 5 seconds to reduce blocking risk.`,
    );
  }

  const products = Array.isArray(rawConfig.products) ? rawConfig.products : [];
  if (products.length === 0) {
    throw new Error("config.json must contain at least one product.");
  }

  const normalizedProducts = products.map((product, index) => {
    if (!product.url) {
      throw new Error(`Product at index ${index} is missing a url.`);
    }

    return {
      name: product.name || `Product ${index + 1}`,
      url: product.url,
      fetchMode: product.fetchMode || rawConfig.fetchMode || "http",
      requiredKeywords: product.requiredKeywords || [],
      inStockKeywords: product.inStockKeywords || DEFAULT_IN_STOCK_KEYWORDS,
      outOfStockKeywords: product.outOfStockKeywords || DEFAULT_OUT_OF_STOCK_KEYWORDS,
      headers: product.headers || {},
      timeoutSeconds: clampNumber(product.timeoutSeconds, 20, 3, 120),
    };
  });

  return {
    discordWebhookUrl:
      rawConfig.discordWebhookUrl || process.env.DISCORD_WEBHOOK_URL || "",
    discordMention: rawConfig.discordMention || process.env.DISCORD_MENTION || "",
    checkIntervalSeconds,
    jitterSeconds: clampNumber(rawConfig.jitterSeconds, 2, 0, 60),
    notificationCooldownSeconds: clampNumber(
      rawConfig.notificationCooldownSeconds,
      3600,
      0,
      86400,
    ),
    notifyOnStart: Boolean(rawConfig.notifyOnStart),
    onlyNotifyOnChange: rawConfig.onlyNotifyOnChange !== false,
    statePath: path.resolve(configDir, rawConfig.statePath || ".stock-tracker-state.json"),
    browser: {
      headless: Boolean(rawConfig.browserHeadless),
      userDataDir: path.resolve(configDir, rawConfig.browserUserDataDir || ".browser-profile"),
      chromeExecutablePath: rawConfig.chromeExecutablePath || "",
      nodeModulesPath: rawConfig.nodeModulesPath || DEFAULT_NODE_MODULES_PATH,
      waitUntil: rawConfig.browserWaitUntil || "domcontentloaded",
      waitMs: clampNumber(rawConfig.browserWaitMs, 3000, 0, 30000),
      challengeTimeoutSeconds: clampNumber(
        rawConfig.browserChallengeTimeoutSeconds,
        180,
        0,
        900,
      ),
    },
    products: normalizedProducts,
  };
}

function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNeedle(value) {
  return String(value || "").trim().toLowerCase();
}

function findKeywordMatches(text, keywords) {
  const normalizedText = normalizeNeedle(text);
  return keywords
    .map((keyword) => normalizeNeedle(keyword))
    .filter((keyword) => keyword.length > 0 && normalizedText.includes(keyword));
}

function extractStructuredAvailability(html) {
  const matches = [];
  const patterns = [
    /"availability"\s*:\s*"([^"]+)"/gi,
    /"availability"\s*:\s*\{\s*"@id"\s*:\s*"([^"]+)"/gi,
    /itemprop=["']availability["'][^>]*(?:href|content)=["']([^"']+)["']/gi,
    /schema\.org\/(InStock|LimitedAvailability|PreOrder|OutOfStock|SoldOut|Discontinued|BackOrder)/gi,
  ];

  for (const pattern of patterns) {
    let match = pattern.exec(html);
    while (match) {
      matches.push(match[1]);
      match = pattern.exec(html);
    }
  }

  return matches.map((value) =>
    String(value)
      .split("/")
      .pop()
      .replace(/[^a-z]/gi, "")
      .toLowerCase(),
  );
}

function detectStock(html, product) {
  const visibleText = htmlToText(html);
  const combinedText = `${visibleText} ${html}`;

  const missingRequired = product.requiredKeywords
    .map((keyword) => normalizeNeedle(keyword))
    .filter((keyword) => keyword && !normalizeNeedle(combinedText).includes(keyword));

  if (missingRequired.length > 0) {
    return {
      status: "unknown",
      reason: `Missing required keyword(s): ${missingRequired.join(", ")}`,
      matches: [],
    };
  }

  const structuredAvailability = extractStructuredAvailability(html);
  const positiveAvailability = structuredAvailability.find((value) =>
    POSITIVE_STRUCTURED_AVAILABILITY.has(value),
  );
  const negativeAvailability = structuredAvailability.find((value) =>
    NEGATIVE_STRUCTURED_AVAILABILITY.has(value),
  );

  if (positiveAvailability && !negativeAvailability) {
    return {
      status: "in_stock",
      reason: `Structured availability: ${positiveAvailability}`,
      matches: [positiveAvailability],
    };
  }

  if (negativeAvailability && !positiveAvailability) {
    return {
      status: "out_of_stock",
      reason: `Structured availability: ${negativeAvailability}`,
      matches: [negativeAvailability],
    };
  }

  const outOfStockMatches = findKeywordMatches(combinedText, product.outOfStockKeywords);
  const inStockMatches = findKeywordMatches(combinedText, product.inStockKeywords);

  if (outOfStockMatches.length > 0) {
    return {
      status: "out_of_stock",
      reason: `Matched out-of-stock text: ${outOfStockMatches.join(", ")}`,
      matches: outOfStockMatches,
    };
  }

  if (inStockMatches.length > 0) {
    return {
      status: "in_stock",
      reason: `Matched in-stock text: ${inStockMatches.join(", ")}`,
      matches: inStockMatches,
    };
  }

  return {
    status: "unknown",
    reason: "No stock keywords or structured availability were found.",
    matches: [],
  };
}

async function fetchHttpPage(product) {
  const controller = new AbortController();
  const timeoutMs = product.timeoutSeconds * 1000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    "user-agent": DEFAULT_USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    ...product.headers,
  };

  try {
    const response = await fetch(product.url, {
      headers,
      redirect: "follow",
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      finalUrl: response.url,
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function isSecurityChallenge(body) {
  const normalized = normalizeNeedle(`${htmlToText(body)} ${body}`);
  return (
    normalized.includes("captcha challenge") ||
    normalized.includes("__cf_chl") ||
    (normalized.includes("one more step") && normalized.includes("security check"))
  );
}

function loadPlaywright(config) {
  const candidateLoaders = [createRequire(import.meta.url)];
  const nodePathRoots = [
    ...(process.env.NODE_PATH || "").split(path.delimiter),
    config.browser.nodeModulesPath,
    DEFAULT_NODE_MODULES_PATH,
  ].filter(Boolean);

  for (const root of nodePathRoots) {
    candidateLoaders.push(createRequire(path.join(root, "__stock_tracker_loader.cjs")));
  }

  for (const loader of candidateLoaders) {
    try {
      return loader("playwright");
    } catch {
      // Try the next module root.
    }
  }

  throw new Error(
    "Browser mode needs the playwright package. Run this tracker with run.command, which sets NODE_PATH.",
  );
}

async function findChromeExecutable(config) {
  const candidates = [
    config.browser.chromeExecutablePath,
    ...DEFAULT_CHROME_PATHS,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }

  return "";
}

async function readBrowserPageBody(page) {
  const visibleText = await page
    .locator("body")
    .innerText({ timeout: 5000 })
    .catch(() => "");
  const html = await page.content().catch(() => "");
  return `${visibleText}\n${html}`;
}

function createPageFetcher(config) {
  let browserContext = null;
  let browserPageByProduct = new Map();

  async function getBrowserContext() {
    if (browserContext) return browserContext;

    const { chromium } = loadPlaywright(config);
    const executablePath = await findChromeExecutable(config);
    const launchOptions = {
      headless: config.browser.headless,
      viewport: { width: 1365, height: 900 },
      locale: "en-US",
      timezoneId: "America/Los_Angeles",
      userAgent: DEFAULT_USER_AGENT.replace(" stock-tracker/1.0", ""),
      args: ["--disable-blink-features=AutomationControlled"],
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    console.log(
      `[${timestamp()}] Starting browser mode${executablePath ? ` with ${executablePath}` : ""}.`,
    );

    browserContext = await chromium.launchPersistentContext(
      config.browser.userDataDir,
      launchOptions,
    );
    browserContext.setDefaultTimeout(10000);
    return browserContext;
  }

  async function fetchBrowserPage(product) {
    const context = await getBrowserContext();
    let page = browserPageByProduct.get(productKey(product));

    if (!page || page.isClosed()) {
      page = await context.newPage();
      browserPageByProduct.set(productKey(product), page);
    }

    const response = await page.goto(product.url, {
      waitUntil: config.browser.waitUntil,
      timeout: product.timeoutSeconds * 1000,
    });
    await page.waitForTimeout(config.browser.waitMs);

    let body = await readBrowserPageBody(page);
    let challenge = isSecurityChallenge(body);

    if (challenge && config.browser.challengeTimeoutSeconds > 0 && !config.browser.headless) {
      console.warn(
        `[${timestamp()}] FragranceNet opened a security check. Complete it in the Chrome window; waiting up to ${config.browser.challengeTimeoutSeconds}s.`,
      );

      const deadline = Date.now() + config.browser.challengeTimeoutSeconds * 1000;
      while (challenge && Date.now() < deadline) {
        await page.waitForTimeout(5000);
        body = await readBrowserPageBody(page);
        challenge = isSecurityChallenge(body);
      }
    }

    return {
      ok: !challenge,
      statusCode: response?.status() || 0,
      finalUrl: page.url(),
      challenge,
      body,
    };
  }

  return {
    async fetchPage(product) {
      if (product.fetchMode === "browser") {
        return fetchBrowserPage(product);
      }
      return fetchHttpPage(product);
    },
    async close() {
      for (const page of browserPageByProduct.values()) {
        await page.close().catch(() => {});
      }
      browserPageByProduct = new Map();
      if (browserContext) {
        await browserContext.close().catch(() => {});
        browserContext = null;
      }
    },
  };
}

function productKey(product) {
  return product.url;
}

function allowedMentionsFor(mention) {
  const parse = [];
  if (mention.includes("@everyone") || mention.includes("@here")) {
    parse.push("everyone");
  }
  if (mention.includes("<@") && !mention.includes("<@&")) {
    parse.push("users");
  }
  if (mention.includes("<@&")) {
    parse.push("roles");
  }
  return { parse };
}

async function sendDiscord(config, payload) {
  if (!config.discordWebhookUrl) {
    console.warn(`[${timestamp()}] Discord webhook is empty; notification skipped.`);
    return false;
  }

  const response = await fetch(config.discordWebhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (response.status === 429) {
    const rateLimit = await response.json().catch(() => ({}));
    const retryAfterMs = Math.ceil(Number(rateLimit.retry_after || 1) * 1000);
    console.warn(`[${timestamp()}] Discord rate limited; retrying in ${retryAfterMs}ms.`);
    await sleep(retryAfterMs);
    return sendDiscord(config, payload);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Discord webhook failed with ${response.status}: ${body}`);
  }

  return true;
}

function buildStockPayload(config, product, result) {
  const contentPrefix = config.discordMention ? `${config.discordMention} ` : "";
  return {
    content: `${contentPrefix}${product.name} appears to be in stock: ${product.url}`,
    allowed_mentions: allowedMentionsFor(config.discordMention),
    embeds: [
      {
        title: `${product.name} is in stock`,
        url: product.url,
        color: 0x22c55e,
        fields: [
          { name: "Reason", value: result.reason.slice(0, 1024) || "Detected in stock" },
          { name: "Checked", value: timestamp() },
        ],
      },
    ],
  };
}

function buildStartPayload(config) {
  const productLines = config.products.map((product) => `- ${product.name}`).join("\n");
  return {
    content: "Stock tracker started.",
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: "Stock tracker is running",
        color: 0x0ea5e9,
        fields: [
          { name: "Products", value: productLines.slice(0, 1024) || "None" },
          { name: "Interval", value: `${config.checkIntervalSeconds}s` },
        ],
      },
    ],
  };
}

async function checkProduct(config, state, product, fetcher) {
  const previous = state.products[productKey(product)] || {};
  const checkedAt = timestamp();

  try {
    const page = await fetcher.fetchPage(product);
    const result = page.ok
      ? detectStock(page.body, product)
      : {
          status: "unknown",
          reason: page.challenge
            ? "Security challenge still active. Complete it in the Chrome window."
            : `HTTP ${page.statusCode}`,
          matches: [],
        };

    const statusChanged = previous.lastStatus !== result.status;
    const cooldownUntil =
      previous.lastNotifiedAt &&
      Date.parse(previous.lastNotifiedAt) + config.notificationCooldownSeconds * 1000;
    const cooldownExpired = !cooldownUntil || Date.now() >= cooldownUntil;
    const shouldNotify =
      result.status === "in_stock" &&
      cooldownExpired &&
      (!config.onlyNotifyOnChange || previous.lastStatus !== "in_stock" || !previous.lastNotifiedAt);

    state.products[productKey(product)] = {
      name: product.name,
      url: product.url,
      lastStatus: result.status,
      lastReason: result.reason,
      lastCheckedAt: checkedAt,
      lastChangedAt: statusChanged ? checkedAt : previous.lastChangedAt || checkedAt,
      lastNotifiedAt: previous.lastNotifiedAt || null,
    };

    if (shouldNotify) {
      try {
        const delivered = await sendDiscord(config, buildStockPayload(config, product, result));
        if (delivered) {
          state.products[productKey(product)].lastNotifiedAt = checkedAt;
          console.log(`[${checkedAt}] NOTIFIED ${product.name}: ${result.reason}`);
        } else {
          console.log(
            `[${checkedAt}] ${product.name}: in_stock - ${result.reason} (notification skipped)`,
          );
        }
      } catch (notifyError) {
        console.error(
          `[${checkedAt}] ${product.name}: in_stock - ${result.reason}; Discord failed - ${notifyError.message}`,
        );
      }
    } else {
      console.log(`[${checkedAt}] ${product.name}: ${result.status} - ${result.reason}`);
    }
  } catch (error) {
    state.products[productKey(product)] = {
      name: product.name,
      url: product.url,
      lastStatus: "error",
      lastReason: error.message,
      lastCheckedAt: checkedAt,
      lastChangedAt:
        previous.lastStatus === "error" ? previous.lastChangedAt || checkedAt : checkedAt,
      lastNotifiedAt: previous.lastNotifiedAt || null,
    };
    console.error(`[${checkedAt}] ${product.name}: error - ${error.message}`);
  }
}

function getJitterMs(config) {
  if (config.jitterSeconds <= 0) return 0;
  return Math.floor(Math.random() * config.jitterSeconds * 1000);
}

async function run(config, options) {
  if (options.testDiscord) {
    await sendDiscord(config, {
      content: `${config.discordMention ? `${config.discordMention} ` : ""}Stock tracker Discord test message.`,
      allowed_mentions: allowedMentionsFor(config.discordMention),
    });
    console.log(`[${timestamp()}] Discord test message sent.`);
    return;
  }

  const state = await loadState(config.statePath);
  const fetcher = createPageFetcher(config);
  let shuttingDown = false;

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await fetcher.close();
  };

  process.once("SIGINT", async () => {
    console.log(`\n[${timestamp()}] Stopping stock tracker.`);
    await shutdown();
    process.exit(130);
  });

  if (config.notifyOnStart) {
    await sendDiscord(config, buildStartPayload(config));
  }

  try {
    do {
      await Promise.all(
        config.products.map((product) => checkProduct(config, state, product, fetcher)),
      );
      await writeJson(config.statePath, state);

      if (options.once) break;

      const waitMs = config.checkIntervalSeconds * 1000 + getJitterMs(config);
      console.log(`[${timestamp()}] Waiting ${Math.round(waitMs / 1000)}s before next check.`);
      await sleep(waitMs);
    } while (true);
  } finally {
    await shutdown();
  }
}

function runSelfTest() {
  const product = {
    name: "Test product",
    requiredKeywords: [],
    inStockKeywords: DEFAULT_IN_STOCK_KEYWORDS,
    outOfStockKeywords: DEFAULT_OUT_OF_STOCK_KEYWORDS,
  };

  const inStock = detectStock(
    '<script type="application/ld+json">{"offers":{"availability":"https://schema.org/InStock"}}</script>',
    product,
  );
  const outOfStock = detectStock("<button>Sold Out</button>", product);
  const keywordStock = detectStock("<button>Add to cart</button>", product);

  const failures = [];
  if (inStock.status !== "in_stock") failures.push("structured in-stock detection failed");
  if (outOfStock.status !== "out_of_stock") failures.push("out-of-stock keyword detection failed");
  if (keywordStock.status !== "in_stock") failures.push("in-stock keyword detection failed");

  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }

  console.log("Self-test passed.");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selfTest) {
    runSelfTest();
    return;
  }

  const configPath = path.resolve(args.configPath || "config.json");
  const rawConfig = await readJson(configPath);
  const config = normalizeConfig(rawConfig, configPath);
  await run(config, args);
}

main().catch((error) => {
  console.error(`[${timestamp()}] ${error.stack || error.message}`);
  process.exitCode = 1;
});
