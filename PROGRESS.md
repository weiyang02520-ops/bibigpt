# BibiGPT Self-host Deployment Progress

## 2026-07-15

### Goal

Deploy the open-source BibiGPT v1 web application to the user's GitHub and Vercel accounts for personal BYOK use.

### Repository and deployment

- GitHub: `weiyang02520-ops/bibigpt`
- Production URL: `https://bibigpt-six.vercel.app`
- Initial failed deployment: `dpl_9drq3drpwarF5Mh1swwMS5DeLPwD`
- Final production deployment: `dpl_D1rgH3YFXFa6DxpbDLHZRJQ4DU5M`
- Final production status: `Ready`

### Root cause

The original build compiled successfully, then failed while prerendering `/openrouter/callback`. The application created a
Supabase client unconditionally, but the Vercel project did not have `NEXT_PUBLIC_SUPABASE_URL` or
`NEXT_PUBLIC_SUPABASE_ANON_KEY`.

The same code path also treated Upstash and a server-side OpenAI key as required even though the UI supports users
entering their own compatible API key.

### Changes

- Made Supabase optional and hid account login when it is not configured.
- Made Upstash cache and rate limiting optional and isolated cache failures from the response stream.
- Removed build-time API-key checks; missing keys are now reported only when a request has neither a browser key nor a
  server key.
- Corrected the Next.js 16 Proxy matcher export from `proxyConfig` to `config`.
- Disabled the self-referential API rewrite when `INTERNAL_API_HOSTNAME` is unset.
- Disabled Segment initialization when `NEXT_PUBLIC_SEGMENT_WRITEKEY` is unset.
- Documented the personal BYOK deployment mode in `README.md` and `.example.env`.
- Added `backups/` to Git ignore and TypeScript exclusions. The pre-edit backup is under
  `backups/20260715-153940/` and is intentionally untracked.

### Verification

- `npm ci --ignore-scripts --no-audit --no-fund`: passed, 1005 packages installed.
- `npx prettier --check ...`: passed for changed source and config files.
- `npm run build` with no Supabase, Upstash, Segment, or server OpenAI variables: passed.
- Local smoke test: `/` and `/openrouter/callback` returned 200; `/api/chat` returned 405 for GET and 400 for an empty
  JSON POST.
- Vercel preview and production deployments both reached `Ready`.
- Browser verification on the production alias confirmed the API-key field, Base URL field, video URL field, and 132
  model options. No browser console warnings or errors remained after the final deployment.

### Usage

Open `https://bibigpt-six.vercel.app`, enter an OpenAI-compatible API key and Base URL in the page, paste a Bilibili or
YouTube URL, and run the summary. The browser stores the key in local storage and sends it only to this deployment's
API route.

### Known limits and risks

- No Upstash means no shared cache or rate limiting. Do not share the site publicly without adding protection or rate
  limiting, because a server-side key could otherwise incur cost.
- A browser-entered key is stored in that browser's local storage. Use this only on a trusted device and deployment.
- Reliable Bilibili subtitle access may require `BILIBILI_SESSION_TOKEN` in Vercel.
- YouTube subtitle extraction uses the maintained `youtube-transcript` package and no longer depends on SaveSubs.
  It still relies on unofficial YouTube interfaces, so upstream policy changes remain a risk.
- BibiGPT v1 uses existing subtitles only. It does not provide local ASR, local audio/video upload, screenshots, or an
  Obsidian export pipeline.
- Very long transcripts are sampled by the upstream implementation rather than summarized exhaustively. Long-course
  processing needs a chunked pipeline before it can be considered reliable.

### Next work

- Test one real Bilibili video with the user's own compatible API key.
- Add `BILIBILI_SESSION_TOKEN` only if public subtitles cannot be fetched.
- Keep the separate `course-obsidian-pipeline` project for chunked long-course notes, screenshots, and Obsidian export.

## 2026-07-15 Personal BYOK hardening

### Backup

- Pre-edit rollback copy: `backups/20260715-170146-personal-byok/` (intentionally untracked).

### Changes

- Removed all runtime Lemon License, purchase redirect, daily-count and commercial rate-limit logic.
- Replaced the collapsed License field with visible browser-local API Key and Base URL controls; the Key is masked by
  default and has a show/hide button.
- Added arbitrary OpenAI-compatible model IDs with optional OpenRouter datalist suggestions. Custom IDs are persisted
  independently and are not overwritten by OpenRouter results.
- Validates model configuration before fetching subtitles. Production Base URLs must use public HTTPS and reject
  localhost, private, link-local and other non-public IP ranges.
- Requires non-empty real subtitle items. Video descriptions are no longer accepted as summary input.
- Replaced blocked SaveSubs extraction with `youtube-transcript@1.3.1`; video files are never downloaded.
- Added explicit Bilibili HTTP/business-code validation and omitted the Cookie header when no Session Token exists.
- Added a restricted `/api/b23tv` resolver that validates every redirect and only accepts final Bilibili video URLs.
- Disabled response compression for `/api/chat` so text reaches the browser as real stream chunks.
- Versioned optional cache keys and included every prompt-affecting option plus provider identity.
- Removed upstream promotion links, checkout routes, author follow links and stale Vercel admin redirects.
- Added a local privacy page, personal deployment documentation and a transcript-gated mock OpenAI-compatible server.

### Local verification

- Changed-file Prettier check: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; `/api/b23tv`, `/api/chat`, `/api/sumup` and `/privacy` are present in the production build.
- Missing API Key and missing model ID each return HTTP 400 before any subtitle request.
- Real YouTube URL `dQw4w9WgXcQ` produced 61 subtitle rows and reached the local model mock.
- `/api/chat` returned four separately timed text chunks, confirming browser-visible streaming rather than one gzip
  buffer.
- Bilibili video `BV1fX4y1Q7Ux` returned HTTP 422 with model mock count unchanged (`0 -> 0`), proving that missing
  subtitles do not call the model and descriptions are not used as fallback.
- Production-mode Base URL checks rejected HTTP, localhost and `127.0.0.1`, while accepting the public OpenAI HTTPS
  URL before model validation.
- `https://b23.tv/BV1fX4y1Q7Ux` resolved to the expected Bilibili video; non-b23 and non-video targets were rejected.
- In-app browser verification passed on desktop and 390 px mobile layouts. It also confirmed masked Key rendering,
  custom-model persistence, the privacy page and the full local result workflow.

### Remaining before completion

- Push the reviewed commit to GitHub and wait for the Vercel production deployment.
- Verify YouTube subtitle extraction from the Vercel runtime.
- Use the user's real API Key, Base URL and model ID for one final production summary. Do not record the secret.
