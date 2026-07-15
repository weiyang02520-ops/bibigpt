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
- YouTube subtitle extraction depends on SaveSubs and may require `SAVESUBS_X_AUTH_TOKEN`; upstream reliability is
  limited.
- BibiGPT v1 uses existing subtitles only. It does not provide local ASR, local audio/video upload, screenshots, or an
  Obsidian export pipeline.
- Very long transcripts are sampled by the upstream implementation rather than summarized exhaustively. Long-course
  processing needs a chunked pipeline before it can be considered reliable.

### Next work

- Test one real Bilibili video with the user's own compatible API key.
- Add `BILIBILI_SESSION_TOKEN` only if public subtitles cannot be fetched.
- Keep the separate `course-obsidian-pipeline` project for chunked long-course notes, screenshots, and Obsidian export.
