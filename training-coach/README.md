# Personal 70.3 Training Coach

Private 24-week dashboard for the plan starting 10 November 2026 and racing 24 April 2027. Swim/bike/run plus upper maintenance, lower strength, core, and plyometrics. Build weeks generally fit 8–10 hours; introductory, recovery, and taper weeks are lighter.

- App: https://personal-703-coach.thio-training.workers.dev
- ChatGPT MCP endpoint: https://personal-703-coach.thio-training.workers.dev/mcp
- Infrastructure: personal Cloudflare Workers, D1, and KV free allowances. No paid AI API or domain.

## Connect in personal ChatGPT

1. Open **Plugins → Add → Add custom MCP server**.
2. Name: **70.3 Training Coach**. Server URL: the MCP endpoint above.
3. Choose **OAuth**, acknowledge the notice, and select **Create as a plugin**.
4. Sign in with the app's separate access code and allow the connection. If scopes must be entered manually, use `training:read training:write offline_access`.
5. Install if prompted. In a new chat, select the plugin with `@` and ask **Show my week 1 training dashboard**.

The access code is in the gitignored `.context/training-app-access-code.txt` at the repository root, two directories above this app. Save it in your personal password manager. Never paste it into chat. Its server copy is the encrypted Worker secret `OWNER_ACCESS_CODE`.

If an earlier attempt failed after **Allow**, start a fresh connection from the plugin's connection settings. Do not resubmit the old consent tab. The consent page now permits the validated callback origin in its browser security policy. Refresh the plugin and start a new chat after reconnecting.

Actual ChatGPT tool use and embedding still need verification in your personal account. The authorization flow and saved-plan retrieval are separately tested in a real browser.

## Open on your phone

Sign in to the same personal account in the ChatGPT mobile app, start a new chat, and select **70.3 Training Coach** with `@`. [OpenAI's plugin documentation](https://learn.chatgpt.com/docs/plugins) supports mobile use for plugins available to the account; this particular connection still needs an end-to-end check there.

You can also open the app URL above in your phone browser and sign in with the same app access code. On iPhone, use Safari **Share → Add to Home Screen**; on Android, use Chrome **⋮ → Add to Home screen**. Laptop and phone use the same saved data. The laptop does not need to stay on.

## Interface

The interface combines an IRONMAN 70.3-inspired red, black, and white palette with Apple-inspired system typography, rounded surfaces, and native accessible select controls. It includes a selectable seven-day training board, a weekly discipline ring, and an interactive 24-week hours chart. Selecting a day preserves unsaved drafts on other days. All icons and charts use original CSS/SVG; no font downloads or external assets are required.

Garmin imports appear as sport-specific activity cards, with a weekly recorded-duration chart and sport filters. Cards show duration, local start time, average/maximum heart rate, distance, pace or speed, calories and power when provided by Garmin. Strength cards omit zero-distance metrics. Missing values are not estimated; older imports acquire the additional metrics on the next sync. Activity filtering preserves unsaved workout feedback.

## Feedback

Choose a workout option, mark status, enter actual time/effort/comments, and save. Other unsaved cards retain their drafts. D1 stores append-only versions; stale saves from another device are rejected. Earlier feedback can be restored as a new version.

Mark **Completed**, then select **Save feedback and adapt** to celebrate with a short confetti burst and a success card. Celebrations follow successful saves only; editing an already completed workout or reloading the page does not replay them. Reduced-motion settings replace the animation with the success card alone.

Weekly check-in milestones mark your first check-in, halfway, and every session logged. Saved completed, modified, and skipped sessions all count as check-ins; the completed-workout total stays separate. Milestones are calculated from saved feedback and appear on any device without changing the training plan.

Workout instructions use short warm-up/exercise bullets and separate rest, effort, and week-specific notes. This changes presentation and wording, not the weekly time budgets or progression.

Completion retains scheduled progression; skipped/modified sessions hold it. High effort/fatigue reduces the next comparable workout, and recent leg-pain flags pause relevant leg work. Available preferences carry forward. Completed workouts retain their planned duration.

New comments hold progression until connected ChatGPT calls `interpret_feedback`. Supported ChatGPT widgets request this follow-up; the browser shows a prompt to send to the chat. Interpretation saves a recovery signal and explanation; it does not provide arbitrary plan editing or background AI. Future weeks remain provisional.

## Garmin

Create a Personal API key at https://connect.garmin.com/app/settings/personalApiToken. In personal Cloudflare, open **Workers & Pages → personal-703-coach → Settings → Variables and Secrets**. Add a **Secret** named `GARMIN_API_KEY`, paste the key there, and deploy. Do not paste it into ChatGPT.

Alternatively, in your own terminal run `node scripts/cloudflare.mjs secret put GARMIN_API_KEY` and enter the key at the hidden prompt.

Use **Sync this week**, choose the matching activity in a workout, and save. Import does not automatically complete sessions. Matching uses sport and local date; multisport parent totals are excluded. Start time uses Garmin's activity-local wall clock without converting to the viewing device's timezone. It does not send planned workouts to the watch.

The activity selector explains when there is no matching sport/date, including other dates imported that week. Linking is an explicit choice followed by **Save feedback and adapt**; an empty selector does not mean the Garmin account is disconnected. The same sync action works from the phone website and runs on Cloudflare, so no laptop process is required.

## Development

Node 24+ and `npm install` are required. A single Worker serves the dashboard/API. Cloudflare's OAuth provider handles PKCE, consent, access/refresh tokens. Browser sign-in uses a high-entropy code, hashed sessions in KV, secure cookies, and same-origin checks.

Use `scripts/cloudflare.mjs` for all cloud commands. It isolates login under `.context/cloudflare-personal-config` and removes inherited Cloudflare credential variables. Configuration pins the personal account. Check `node scripts/cloudflare.mjs whoami` before remote changes.

Create gitignored `.dev.vars` with `APP_ORIGIN="http://localhost:8787"` and a random 32+ character `OWNER_ACCESS_CODE`, different from production.

```sh
node scripts/cloudflare.mjs d1 migrations apply DB --local
npm run dev
```

In another terminal:

```sh
npm run check
npm run test:integration
npm run build
```

Integration tests write synthetic feedback only to localhost:8787. They check private access, login/CSRF, cross-origin rejection, stale writes/history, OAuth/PKCE, callback CSP, unregistered redirects, forged consent handles, replay rejection, scopes, refresh, MCP resources and logout. The browser regression script in `.context/reproduce-consent-submit.mjs` exercises actual Allow/Deny redirects, PKCE exchange, and read-only plan retrieval; `--live` uses a temporary test connection and revokes it afterward.

Deploy with:

```sh
node scripts/cloudflare.mjs d1 migrations apply DB --remote
npm run deploy
```

Keep the account on Workers Free. The project does not enable a paid plan or paid AI API. Cloudflare rejects requests when free quotas are exhausted. Production request logging is disabled.
