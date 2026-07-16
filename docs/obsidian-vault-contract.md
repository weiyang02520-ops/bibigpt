# BibiGPT Obsidian Vault Contract

## Purpose

`lib/course/obsidianVault.ts` builds a new Obsidian-ready ZIP or merges one `CourseJob` into a ZIP previously produced
by the same builder. It is a pure packaging layer: the caller remains responsible for selecting and cropping images,
starting a browser download, and choosing which existing ZIP to update.

The builder accepts:

- a `CourseJob` with completed `notes`;
- the source URL used by the lesson;
- already-cropped binary image assets (`timestamp`, `reason`, `path`, and `Blob | Uint8Array` data);
- optionally, an existing ZIP as `ArrayBuffer | Blob`.

It returns the new ZIP `Blob`, parsed manifest, stable `lessonId`, vault root, and current modified/conflict records. The
input ZIP is only read and is never modified in place.

## ZIP layout

Every file is below the fixed top-level directory `BibiGPT-Vault/`:

```text
BibiGPT-Vault/
  00_课程索引.md
  lessons/{lessonId}.md
  transcripts/{lessonId}.md
  review/{lessonId}.md
  assets/{lessonId}/*
  manifest.json
```

`lessonId` is `${service}-${videoId}-p${pageNumber}`. It uses only source identity and never uses a course title. The
current supported platform identifiers are path-safe ASCII; the builder rejects an unsafe identity instead of silently
normalizing two different sources to the same path.

An image asset `path` may be a filename/subpath below `assets/{lessonId}/`, or the complete vault-relative path below
that same directory. Absolute paths, `..`, another lesson's asset directory, duplicate paths, and reserved
`.bibigpt-new` paths are rejected.

## Markdown artifacts

- `00_课程索引.md` is generated from manifest lesson metadata and links every lesson.
- A lesson note contains source identity and URL, overview, chapters, key points, terms, local image links, and links to
  its transcript and review note.
- A transcript entry contains its start and end timestamps, `caption` or `asr` source, segment ID, and text.
- A review note contains a checklist plus chapter-based and terminology-based self-test questions.

All of these files, including the course index and binary assets, are managed artifacts. `manifest.json` is not listed
as an artifact because a manifest cannot include a stable hash of itself.

## Manifest schema version 1

Artifact paths are relative to `BibiGPT-Vault/`.

```json
{
  "schemaVersion": 1,
  "generator": {
    "name": "BibiGPT",
    "version": "obsidian-vault/1"
  },
  "generatedAt": "job.updatedAt",
  "vaultRoot": "BibiGPT-Vault/",
  "lessons": [
    {
      "lessonId": "bilibili-BV...-p1",
      "title": "Course title",
      "sourceUrl": "https://...",
      "sourceIdentity": {
        "service": "bilibili",
        "videoId": "BV...",
        "pageNumber": 1
      },
      "sourceFingerprint": "...",
      "sourceMode": "local-asr",
      "asrModel": "onnx-community/whisper-base",
      "duration": 2570,
      "status": "complete",
      "transcribedUntil": 2570,
      "transcriptSegmentCount": 1195,
      "chunkCount": 6,
      "updatedAt": "job.updatedAt"
    }
  ],
  "artifacts": [
    {
      "path": "lessons/bilibili-BV...-p1.md",
      "type": "lesson",
      "lessonId": "bilibili-BV...-p1",
      "sha256": "...",
      "status": "generated"
    }
  ]
}
```

`generatedAt`, lesson `updatedAt`, and ZIP entry dates for newly generated files all derive from `job.updatedAt`. The
builder does not substitute the wall-clock time. Other lessons retain their previously recorded metadata when a new
lesson is merged.

Artifact `type` is one of `index`, `lesson`, `transcript`, `review`, or `asset`. `status` is `generated`, `modified`, or
`conflict`. The index has no `lessonId`; every other managed artifact belongs to one lesson.

Lesson metadata records the source mode, ASR model when applicable, duration, current workflow stage, transcription
cursor, transcript segment count, and completed summary chunk count. This is enough to audit the exported result and
its source fingerprint; it is not a replacement for the full IndexedDB `CourseJob` and cannot reconstruct an
interrupted ASR or summarization job from the ZIP alone.

## Generated and user-owned boundary

The old manifest is the ownership baseline:

- A file listed with `status: generated` is generator-owned only while its current SHA-256 equals the manifest hash.
- A file not listed in the manifest is unknown/user-owned and is preserved.
- A listed file whose current hash differs from the manifest hash is treated as user-edited, preserved, and marked
  `modified` even when another lesson is being added.
- A listed file that the user deleted is not silently recreated at its canonical path.
- A `conflict` canonical file remains user-owned on later runs. The builder does not infer that a conflict was resolved.

The manifest itself is generator-owned metadata. A ZIP without the exact root manifest, with invalid JSON/schema,
unsafe paths, files outside `BibiGPT-Vault/`, case/Unicode-normalized path collisions, or a manifest not identifying
this builder is rejected. The merger never guesses ownership from filenames.

## Rerun and merge rules

1. A new lesson is added without changing files or metadata for other lessons.
2. Re-running the same source identity replaces that lesson's metadata and regenerates its stable paths.
3. An unchanged generated artifact is safely replaced and receives the new content hash.
4. A user-edited, deleted, or unknown colliding file is preserved. New generated content is written to
   `${path}.bibigpt-new`; the artifact is marked `conflict` and records `proposedPath` and `proposedSha256`.
5. `canonicalFilePresent: false` distinguishes a user-deleted canonical file from a preserved file.
6. A previous unedited proposal may be refreshed on the next run. If the proposal itself was edited, the merge fails
   explicitly instead of overwriting either version.
7. Obsolete generated artifacts for the current lesson are removed only when their current hash still matches the old
   manifest. Modified obsolete files remain in the ZIP as unlisted user-owned files.
8. The course index follows the same hash and conflict rules as every other managed artifact.
9. Existing unknown files are preserved, but paths that collide after NFC normalization and case-folding are rejected
   because they cannot be extracted safely on common Windows/macOS filesystems.

To resolve a conflict, compare the canonical file with `proposedPath`, keep the desired content, and create a fresh
vault when a new generator-owned baseline is required. Conflict state is intentionally sticky in incremental merges.

## Limitations

- Schema version 1 supports only ZIPs produced by this builder. It does not import arbitrary Obsidian vaults or the
  legacy title-rooted BibiGPT export.
- The complete ZIP is read and generated in memory by JSZip. Very large asset collections may exceed browser memory.
- Web Crypto SHA-256, `Blob`, `TextEncoder`, and JSZip browser support are required.
- ZIP entry timestamps are metadata only; content determinism also depends on stable `CourseJob` and asset bytes.
- The builder does not crop images, fetch media, write to disk, trigger downloads, or reconcile edited Markdown.
