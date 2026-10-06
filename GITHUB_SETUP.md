# Run It Free While Your PC Is Off

Use GitHub Actions for the free cloud runner.

## What You Get

- Runs while your PC is off.
- Checks every 5 minutes.
- Sends Discord when the item changes to in stock.
- Costs $0 on GitHub's free public-repo Actions.

GitHub does not allow free scheduled workflows faster than every 5 minutes.

## Setup

1. Create a new GitHub repository.
2. Upload everything inside this `stock-tracker` folder to that repository.
3. In the GitHub repo, go to `Settings` > `Secrets and variables` > `Actions`.
4. Click `New repository secret`.
5. Add this secret:

```text
Name: DISCORD_WEBHOOK_URL
Value: your Discord webhook URL
```

Optional mention secret:

```text
Name: DISCORD_MENTION
Value: @everyone
```

6. Go to the repo's `Actions` tab.
7. Open the `Stock tracker` workflow.
8. Click `Run workflow` once to test it.

After that, GitHub runs it automatically every 5 minutes.

## Important FragranceNet Note

FragranceNet sometimes shows a security check to automated browsers. If the GitHub run says `Security challenge still active`, the free GitHub method is being blocked by FragranceNet.

If that happens, the fully free 24/7 option is an Always Free cloud VM where you can open Chrome once and clear the security check manually.
