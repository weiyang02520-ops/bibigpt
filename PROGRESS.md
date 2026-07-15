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

### Production deployment and real-provider verification

- Final verification rollback copy: `backups/20260715-184832-final-validation/` (intentionally untracked).
- Commit `6095ccc` is on `main` and the production alias `https://bibigpt-six.vercel.app` serves the reviewed BYOK build.
- Current production deployment: `dpl_AwdtTB7ygZUMRwa57A2T1K64SGNe`, status `Ready`.
- The Vercel runtime previously completed the full YouTube transcript -> temporary public OpenAI-compatible mock -> streamed
  browser response path. The temporary mock and tunnel were stopped immediately after verification.
- The user's provider exposes `gpt-5.5` and `gpt-5.5-openai-compact` from its authenticated `/v1/models` endpoint.
- A minimal direct `gpt-5.5` request to `/v1/chat/completions` returned HTTP 200, `text/event-stream`, multiple `data:`
  chunks and `[DONE]`, confirming the API shape required by this application.
- The production page summarized the real YouTube video `dQw4w9WgXcQ` with `gpt-5.5`. The visible result described the
  transcript's repeated promises of loyalty and not giving up, so it was content-grounded rather than a canned success.
- The browser API Key field was cleared after the request and remained empty after a page reload. The secret was not
  written to the repository, Vercel environment variables, backups or this progress log.

### Completion status

- The personal BibiGPT web deployment is usable end to end for YouTube videos with accessible subtitles and the tested
  OpenAI-compatible provider/model configuration.
- A real Bilibili test remains optional because subtitle availability varies and some videos require a
  `BILIBILI_SESSION_TOKEN`; this does not block the verified YouTube workflow.
- Final local audit passed `npx prettier --check PROGRESS.md`, `git diff --check`, `npx tsc --noEmit`, `npm run build`
  and a repository secret-pattern scan. GitHub `origin/main` matches commit `6095ccc`.
- A later read-only `npx vercel inspect` attempt could not start because the local npx cache lacked
  `@tootallnate/quickjs-emscripten`. No global npm packages were changed to work around it; this does not affect the
  already verified production deployment.

## 2026-07-15 Course workflow goal

### Goal and backup

- New acceptance target: a captionless long-course workflow with local ASR, deterministic chunked summarization,
  important frames and Obsidian export.
- Required production reference: `BV1ySLc6QEcB`.
- Pre-edit rollback copy: `backups/20260715-192024-course-workflow/` (intentionally untracked).
- PRD: `docs/course-workflow-prd.md`.

### Diagnosis

- The reference video is one 2,570-second Bilibili page and its public player response contains zero subtitles.
- Its lowest-bandwidth public audio-only stream is about 21 MB, supports byte ranges, and has 513 roughly five-second
  MP4 media fragments. This permits bounded browser processing without downloading the video stream.
- Its progress-preview source contains six 10x10 sprite sheets with 480x270 frames and a binary timestamp index, so
  important screenshots can be produced without downloading the source video.
- The current DogAPI model list contains no ASR model. `/v1/audio/transcriptions` returned 503, `gpt-5.5` ignored an
  OpenAI-style audio part, and both configured Gemini models returned 503 for text-only probes.
- `C:/Users/peng/Desktop/BibiGPT-v1-2.38.0/BibiGPT-v1-2.38.0` is an older source snapshot. It contains only a Whisper
  TODO and does not provide ASR, long-course reduction, frame extraction or Obsidian export code.

### Decision

- Use browser-local Whisper with lazy media range decoding. DogAPI remains the text summarization provider.
- Use established libraries for media decoding, browser inference, IndexedDB persistence and ZIP creation rather than
  implementing those domains ad hoc.

## 2026-07-16 YouTube audio fallback continuation

### Backup

- Pre-edit rollback copies:
  - `backups/20260716-011115-youtube-audio-continue/`
  - `backups/20260716-012806-doc-update/`

### Changes

- Added `lib/youtube/resolveYoutubeAudioStream.ts` using `youtubei.js` to resolve browser-decodable YouTube `audio/mp4`
  streams for local ASR.
- Added a restricted Node `vm` evaluator for YouTube player URL deciphering with string and WASM code generation
  disabled inside the created context.
- Added `pages/api/course/youtube-audio.ts`, a same-origin `HEAD`/`GET` Range proxy with a 2 MiB request limit,
  temporary URL re-resolution and revision checks.
- Updated `lib/course/fetchCourseSource.ts` so YouTube keeps the caption path when captions exist, and falls back to
  `mode: local-asr` plus `/api/course/youtube-audio` when captions are empty or inaccessible.
- Updated the generic local ASR audio-size error message and refreshed `README.md` to describe the course workflow,
  ASR, Range audio handling, Obsidian export and current YouTube frame limitation.

### Local verification

- `npx tsc --noEmit --incremental false`: passed.
- Changed-file Prettier check for the YouTube fallback and ASR files: passed.
- `git diff --check`: passed.
- `npm run build`: passed. The production build includes `/api/course/youtube-audio` alongside the Bilibili course
  APIs.
- Local dev server started at `http://localhost:3000`.
- `POST /api/course/source` for `BV1ySLc6QEcB` returned `mode: local-asr`, duration `2570`, audio size `21062993`, six
  Bilibili sprite images and 512 preview timestamps.
- Bilibili audio proxy smoke tests passed:
  - `HEAD /api/course/bilibili-audio?...` returned 200 with `Content-Length: 21062993`.
  - `GET` with `Range: bytes=0-1023` returned 206 with `Content-Range: bytes 0-1023/21062993`.
- Local YouTube source testing still cannot reach YouTube from this machine. The source API now reports the combined
  path clearly: captions failed, then audio fallback also failed with `fetch failed`. This remains to be verified on
  Vercel or any environment that can reach YouTube.

### Next work

- Re-run `npm run build` after any further edits.
- Push the course workflow branch to GitHub and wait for Vercel.
- Verify `/api/course/source` and `/api/course/youtube-audio` on Vercel with a public captionless YouTube video.
- Run the required production end-to-end acceptance on `https://bibigpt-six.vercel.app` using `BV1ySLc6QEcB`, including
  ASR, chunk summaries, key frames and Obsidian ZIP export.
