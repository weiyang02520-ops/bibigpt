import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { buildObsidianVault, ObsidianVaultManifest } from '~/lib/course/obsidianVault'
import { CourseJob, TranscriptSegment } from '~/lib/course/types'
import { VideoService } from '~/lib/types'

const ROOT = 'BibiGPT-Vault/'

const makeJob = (videoId: string, title: string): CourseJob => {
  const transcript: TranscriptSegment[] = [
    { id: `${videoId}-1`, start: 0, end: 60, text: '第一段课程转写。', source: 'caption' },
    { id: `${videoId}-2`, start: 60, end: 120, text: '第二段课程转写。', source: 'caption' },
  ]
  return {
    version: 2,
    id: `bilibili:${videoId}:1`,
    sourceFingerprint: `fingerprint:${videoId}`,
    sourceUrl: `https://www.bilibili.com/video/${videoId}`,
    asrModel: null,
    status: 'complete',
    source: {
      service: VideoService.Bilibili,
      videoId,
      pageNumber: 1,
      title,
      duration: 120,
      mode: 'captions',
      transcript,
      frames: null,
    },
    transcript,
    transcribedUntil: 120,
    chunkSummaries: [
      {
        start: 0,
        end: 120,
        title: '完整分段',
        summary: '课程内容的分段总结。',
        keyPoints: ['关键点'],
        terms: [{ term: '术语', explanation: '术语解释。' }],
        keyMoments: [{ timestamp: 30, reason: '重要画面' }],
      },
    ],
    notes: {
      title,
      overview: '课程概览。',
      chapters: [{ timestamp: 0, title: '第一章', summary: '章节总结。', details: ['章节细节。'] }],
      takeaways: ['核心要点。'],
      terms: [{ term: '术语', explanation: '术语解释。' }],
      keyMoments: [{ timestamp: 30, reason: '重要画面' }],
    },
    error: null,
    updatedAt: '2026-07-16T02:00:00.000Z',
  }
}

const load = async (blob: Blob) => JSZip.loadAsync(await blob.arrayBuffer())
const asArrayBuffer = (zip: JSZip) => zip.generateAsync({ type: 'arraybuffer' })
const readManifest = async (zip: JSZip) =>
  JSON.parse(await zip.file(`${ROOT}manifest.json`)!.async('string')) as ObsidianVaultManifest

async function main() {
  const firstJob = makeJob('BV1VaultTestA', '课程 [A]')
  const firstLessonId = 'bilibili-BV1VaultTestA-p1'
  const firstLessonPath = `${ROOT}lessons/${firstLessonId}.md`
  const first = await buildObsidianVault(firstJob, firstJob.sourceUrl!, [
    { timestamp: 30, reason: '画面 [A]', path: '01.jpg', data: new Uint8Array([1, 2, 3]) },
  ])
  assert.equal(first.lessonId, firstLessonId)
  assert.equal(first.conflicts.length, 0)

  const firstZip = await load(first.blob)
  for (const path of [
    `${ROOT}00_课程索引.md`,
    firstLessonPath,
    `${ROOT}transcripts/${firstLessonId}.md`,
    `${ROOT}review/${firstLessonId}.md`,
    `${ROOT}assets/${firstLessonId}/01.jpg`,
    `${ROOT}manifest.json`,
  ]) {
    assert.ok(firstZip.file(path), `missing ${path}`)
  }
  const firstManifest = await readManifest(firstZip)
  assert.equal(firstManifest.lessons[0].sourceMode, 'captions')
  assert.equal(firstManifest.lessons[0].transcriptSegmentCount, 2)
  assert.equal(firstManifest.lessons[0].duration, 120)
  assert.ok((await firstZip.file(firstLessonPath)!.async('string')).includes('# 课程 \\[A\\]'))

  const rerun = await buildObsidianVault(firstJob, firstJob.sourceUrl!, [], first.blob)
  assert.equal(rerun.manifest.lessons.length, 1)
  assert.equal(rerun.conflicts.length, 0)

  const editedZip = await load(rerun.blob)
  const generatedLesson = await editedZip.file(firstLessonPath)!.async('string')
  editedZip.file(firstLessonPath, `<!-- 用户修改 -->\n${generatedLesson}`)
  editedZip.file(`${ROOT}我的补充.md`, '# 用户文件\n')
  const conflicted = await buildObsidianVault(firstJob, firstJob.sourceUrl!, [], await asArrayBuffer(editedZip))
  const conflictedZip = await load(conflicted.blob)
  assert.ok((await conflictedZip.file(firstLessonPath)!.async('string')).startsWith('<!-- 用户修改 -->'))
  assert.ok(conflictedZip.file(`${firstLessonPath}.bibigpt-new`))
  assert.ok(conflictedZip.file(`${ROOT}我的补充.md`))
  assert.equal(
    conflicted.manifest.artifacts.find((artifact) => artifact.path === `lessons/${firstLessonId}.md`)?.status,
    'conflict',
  )

  const editBeforeAddingLesson = await load(first.blob)
  editBeforeAddingLesson.file(firstLessonPath, '<!-- 用户修改 A -->\n')
  editBeforeAddingLesson.file(`${ROOT}我的补充.md`, '# 用户文件\n')
  const secondJob = makeJob('BV1VaultTestB', '课程 B')
  const merged = await buildObsidianVault(
    secondJob,
    secondJob.sourceUrl!,
    [],
    await asArrayBuffer(editBeforeAddingLesson),
  )
  const mergedZip = await load(merged.blob)
  assert.equal(merged.manifest.lessons.length, 2)
  assert.equal(
    merged.manifest.artifacts.find((artifact) => artifact.path === `lessons/${firstLessonId}.md`)?.status,
    'modified',
  )
  assert.equal(await mergedZip.file(firstLessonPath)!.async('string'), '<!-- 用户修改 A -->\n')
  assert.ok(mergedZip.file(`${ROOT}我的补充.md`))

  const deletedZip = await load(first.blob)
  deletedZip.remove(`${ROOT}transcripts/${firstLessonId}.md`)
  const deleted = await buildObsidianVault(firstJob, firstJob.sourceUrl!, [], await asArrayBuffer(deletedZip))
  const deletedResultZip = await load(deleted.blob)
  const deletedTranscript = deleted.manifest.artifacts.find(
    (artifact) => artifact.path === `transcripts/${firstLessonId}.md`,
  )
  assert.equal(deletedTranscript?.status, 'conflict')
  assert.equal(deletedTranscript?.canonicalFilePresent, false)
  assert.equal(deletedResultZip.file(`${ROOT}transcripts/${firstLessonId}.md`), null)
  assert.ok(deletedResultZip.file(`${ROOT}transcripts/${firstLessonId}.md.bibigpt-new`))

  const editedProposalZip = await load(deleted.blob)
  editedProposalZip.file(`${ROOT}transcripts/${firstLessonId}.md.bibigpt-new`, '用户也修改了提案。')
  await assert.rejects(
    buildObsidianVault(firstJob, firstJob.sourceUrl!, [], await asArrayBuffer(editedProposalZip)),
    /冲突提案已被编辑/,
  )

  const caseCollisionZip = await load(first.blob)
  caseCollisionZip.file(`${ROOT}Lessons/${firstLessonId}.md`, 'portable collision')
  await assert.rejects(
    buildObsidianVault(firstJob, firstJob.sourceUrl!, [], await asArrayBuffer(caseCollisionZip)),
    /Windows\/macOS/,
  )

  await assert.rejects(
    buildObsidianVault({ ...firstJob, status: 'failed' }, firstJob.sourceUrl!),
    /只有已完成的课程笔记/,
  )

  console.log('Obsidian vault integration checks passed')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
