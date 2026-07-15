# BibiGPT Self-host Deployment Progress

## 2026-07-15

### Goal

Deploy `weiyang02520-ops/bibigpt` to Vercel as a personal BYOK web app and verify the main summary flow.

### Initial failure

- Deployment: `dpl_9drq3drpwarF5Mh1swwMS5DeLPwD`
- Commit: `bda6d2c4214c05bfb48f493ae995bf3eead403d3`
- Vercel compiled the app, then failed while prerendering `/openrouter/callback` because Supabase public environment variables were absent.

### Changes

- Made Supabase authentication optional and hid login UI when it is not configured.
- Made Upstash caching and rate limiting optional for personal deployments.
- Removed build-time server API key checks so users can provide their own key in the browser.
- Accepted user-provided compatible-provider keys when LemonSqueezy licensing is not configured.
- Fixed the Next.js 16 Proxy matcher export and disabled the self-referencing API rewrite when no internal API host is configured.
- Declared the Next.js 16 minimum Node.js version and removed API key values from development logging.

### Verification

- `npm ci --no-audit --no-fund`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build` with no service environment variables: passed; all pages and API routes were generated.
- Local production HTTP checks: `/`, `/openrouter/callback`, and `/api/openrouter/models` returned HTTP 200.
- API validation checks returned the expected HTTP 400/405 responses.
- End-to-end local summary test passed using a real Bilibili URL and a temporary OpenAI-compatible mock provider; `/api/chat` returned a streamed HTTP 200 summary.

### Remaining

- Commit and push the verified changes to `main`.
- Wait for Vercel production deployment and verify the production URL and API routes.
- A real paid-provider summary still requires the user to enter their own API key in the deployed UI.
