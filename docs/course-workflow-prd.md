# Course Workflow PRD

## Goal

Turn the personal BibiGPT deployment into a course-learning tool that works when a supported video has no accessible
captions. The workflow must remain browser-first and BYOK, avoid downloading the full video, preserve resumable progress,
and produce a useful Obsidian-ready artifact.

The release is not complete until the production site processes the user's reference video:

- URL: `https://www.bilibili.com/video/BV1ySLc6QEcB`
- Title: `Git+Github核心概念大串讲，从零到一全攻略，详细实战教程`
- Duration: about 42 minutes 50 seconds

## Verified Input Facts

- The public Bilibili player API returns zero subtitle tracks for the reference video.
- The video has one page and a public DASH AAC audio stream.
- The lowest-bandwidth audio is about 21 MB and supports byte-range requests.
- Its MP4 index contains 513 independently addressable media fragments of about five seconds each.
- Bilibili exposes six 10x10 preview sprite sheets at 480x270 per frame and a binary timestamp index.
- The configured DogAPI account exposes text/image models but no speech-to-text model.
- DogAPI `gpt-5.5` ignores OpenAI-style audio input; its current Gemini routes return 503 even for text-only probes.

## User Workflow

1. The user pastes a Bilibili or YouTube URL and starts a course summary.
2. The app first uses existing captions when they are complete and accessible.
3. If captions are unavailable, the app resolves the lowest-bandwidth audio-only stream.
4. The browser lazily reads and decodes bounded audio ranges and runs local Whisper ASR in a worker.
5. Transcript segments and progress are persisted in IndexedDB so the job can resume without repeating completed work.
6. The app sends bounded transcript chunks to the user's OpenAI-compatible text model for map summaries.
7. A final reduce step creates structured notes, chapters, key takeaways, terminology, and important timestamps.
8. Important timestamps are matched to Bilibili preview frames or source video frames.
9. The user can download an Obsidian ZIP containing Markdown and selected images.

## Architecture

### Source resolution

- Add a source-inspection API that returns validated metadata, existing subtitles, audio stream metadata, and frame
  manifest data.
- Only resolve media URLs from supported Bilibili or YouTube identifiers. Never accept an arbitrary media URL from the
  client.
- Prefer subtitles. Local ASR is a fallback, not the default path.

### Local ASR

- Use `mediabunny` for lazy URL range reads and browser-native audio decoding.
- Use `@huggingface/transformers` in a dedicated worker with a multilingual Whisper model.
- Prefer WebGPU; provide a WASM fallback and a clear unsupported-browser state.
- Process bounded windows, release decoded buffers after each window, and never retain the complete video or decoded
  course audio in memory.
- Store transcript text, timestamps, completed ranges, model identity, and source fingerprint in IndexedDB. Never store
  API keys in job data.

### Course summarization

- Replace random transcript sampling with deterministic, timestamp-preserving chunks.
- Summarize chunks independently and reduce their structured results hierarchically when necessary.
- Keep each server request bounded so Vercel request duration is not proportional to the full course length.
- Use the user's configured text model only after transcript text exists.

### Frames and export

- Parse Bilibili preview timestamps and sprite coordinates.
- Crop only model-selected important timestamps in the browser.
- Generate deterministic Markdown with source URL, title, overview, chapters, takeaways, terms, transcript references,
  and local image links.
- Package Markdown and images with `jszip` for direct import into an Obsidian vault.

## UI Requirements

- Keep the existing compact tool layout; do not add a marketing page.
- Show explicit stages: inspecting source, loading local model, transcribing, summarizing chunks, composing notes, and
  preparing export.
- Show completed/total duration and allow cancellation and resume.
- Do not describe implementation details in normal page copy. Surface only decisions the user needs to make.
- Keep API Key, Base URL, text model, and ASR quality settings persistent in the same browser.

## Success Criteria

- API configuration remains after a normal refresh.
- The reference Bilibili video no longer ends with "没有找到可用字幕".
- The browser transcribes the full reference audio without downloading the video stream.
- Notes cover Git/GitHub concepts from multiple portions of the course, not only the beginning.
- At least three important frames are visible and included in an export.
- Exported ZIP opens with a Markdown file whose local image links resolve inside an Obsidian vault.
- Refreshing during or after transcription can resume from persisted progress.
- Existing caption-based YouTube and Bilibili paths continue to work.
- Prettier, TypeScript, production build, security checks, desktop and mobile browser checks pass before deployment.

## Risks and Boundaries

- The first local Whisper run downloads a large model and can take several minutes. Progress must be visible.
- WebGPU availability and speed vary; WASM is slower and may be unsuitable for very long courses.
- Bilibili and YouTube media URL/CORS behavior can change. Source failures must be explicit and retryable.
- Browser storage is finite. Finished jobs need a delete action and large transient audio buffers must not be persisted.
- The provider API can still be expensive for map/reduce summaries. The UI must show the number of model calls before
  starting that stage.
