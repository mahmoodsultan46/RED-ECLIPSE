# Free Stock Tracker With Discord Alerts

This tracker is configured for:

`Bujairami Red Eclipse Eau De Parfum Spray 3.4 oz`

`https://www.fragrancenet.com/fragrances/bujairami/bujairami-red-eclipse/eau-de-parfum`

It checks the FragranceNet page, looks for stock signals, and sends a Discord webhook notification when the item appears to become available.

FragranceNet currently shows a browser security challenge to plain script requests, so this config uses browser mode with your installed Google Chrome.

## Setup

1. Double-click `run.command`.
2. Paste your Discord webhook URL when prompted.
3. If a FragranceNet security check opens in Chrome, complete it once.

You can also put the webhook directly into `config.json` under `discordWebhookUrl`. Leave the product URL as-is unless you want to track a different item.

Optional Discord mentions:

- `"discordMention": "@everyone"` alerts everyone who can see the Discord channel.
- `"discordMention": "<@1234567890>"` alerts one Discord user.
- Leave it blank for a normal message.

## Run It

### While This Computer Is On

From this folder:

```bash
./run.command
```

Keep the terminal window open. Press `Ctrl+C` to stop the tracker.

### While This Computer Is Off

Use GitHub Actions. See [GITHUB_SETUP.md](GITHUB_SETUP.md).

To check once and exit:

```bash
/Users/mahmoudsultan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node stock-tracker.mjs config.json --once
```

To test only the Discord webhook:

```bash
/Users/mahmoudsultan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node stock-tracker.mjs config.json --test-discord
```

## Speed

`checkIntervalSeconds` controls how often it checks. It is already set to `5`, the fastest interval this tracker allows. Checking faster than that is likely to get blocked by the store or cause rate-limit problems.

For free continuous monitoring, leave the script running on your computer. Free cloud hosts usually sleep, throttle, or ban very frequent scraping.

## FragranceNet Browser Mode

The config has:

```json
"fetchMode": "browser",
"browserHeadless": false
```

That means the tracker can use Chrome cookies after you clear FragranceNet's security check. The browser profile is saved in `.browser-profile` inside this folder.

## Making Detection More Accurate

The default config checks common page text like `add to cart`, `in stock`, `sold out`, and `out of stock`. Some stores show unrelated products on the same page, so a page can contain both `add to cart` and `sold out`. If the tracker reports `unknown`, make the keywords more specific.

Examples:

```json
"inStockKeywords": ["Add to cart - Size 10", "Ready to ship"],
"outOfStockKeywords": ["Size 10 sold out", "Email me when available"]
```

Use `requiredKeywords` when you want to make sure the tracker is seeing the right part of the page:

```json
"requiredKeywords": ["Exact Product Name"]
```

## Limitations

Discord notifications require a webhook URL. FragranceNet may still rate-limit or challenge very frequent checks, so keep the interval at `5` seconds unless you need to be gentler.
