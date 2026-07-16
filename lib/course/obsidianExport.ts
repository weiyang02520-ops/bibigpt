import { formatTimestamp } from '~/lib/course/chunkTranscript'
import { buildObsidianVault, getObsidianLessonId, ObsidianVaultBuildResult } from '~/lib/course/obsidianVault'
import { CourseFrameManifest, CourseJob } from '~/lib/course/types'

export type FrameReference = {
  timestamp: number
  imageUrl: string
  sheetIndex: number
  column: number
  row: number
  frameWidth: number
  frameHeight: number
  columns: number
  rows: number
}

const yamlString = (value: string) => JSON.stringify(value.replace(/[\r\n]+/g, ' ').trim())
const markdownUrl = (value: string) => `<${value.replace(/</g, '%3C').replace(/>/g, '%3E')}>`

export function getFrameReference(manifest: CourseFrameManifest, timestamp: number): FrameReference | null {
  if (manifest.timestamps.length < 1 || manifest.images.length < 1) {
    return null
  }

  let closestIndex = 0
  let closestDistance = Math.abs(manifest.timestamps[0] - timestamp)
  for (let index = 1; index < manifest.timestamps.length; index += 1) {
    const distance = Math.abs(manifest.timestamps[index] - timestamp)
    if (distance < closestDistance) {
      closestIndex = index
      closestDistance = distance
    }
  }

  const framesPerSheet = manifest.columns * manifest.rows
  const sheetIndex = Math.floor(closestIndex / framesPerSheet)
  const indexInSheet = closestIndex % framesPerSheet
  const imageUrl = manifest.images[sheetIndex]
  if (!imageUrl) {
    return null
  }

  return {
    timestamp: manifest.timestamps[closestIndex],
    imageUrl,
    sheetIndex,
    column: indexInSheet % manifest.columns,
    row: Math.floor(indexInSheet / manifest.columns),
    frameWidth: manifest.frameWidth,
    frameHeight: manifest.frameHeight,
    columns: manifest.columns,
    rows: manifest.rows,
  }
}

const cropFrame = async (frame: FrameReference) => {
  const response = await fetch(frame.imageUrl, { signal: AbortSignal.timeout(20000) })
  if (!response.ok) {
    throw new Error(`关键画面下载失败（HTTP ${response.status}）`)
  }
  const bitmap = await createImageBitmap(await response.blob())
  try {
    const canvas = document.createElement('canvas')
    canvas.width = frame.frameWidth
    canvas.height = frame.frameHeight
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('当前浏览器不能裁切关键画面')
    }
    context.drawImage(
      bitmap,
      frame.column * frame.frameWidth,
      frame.row * frame.frameHeight,
      frame.frameWidth,
      frame.frameHeight,
      0,
      0,
      frame.frameWidth,
      frame.frameHeight,
    )
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('关键画面编码失败'))), 'image/jpeg', 0.9)
    })
  } finally {
    bitmap.close()
  }
}

export const selectCourseFrames = (job: CourseJob, maximum = 8) => {
  if (!job.notes || !job.source.frames || maximum < 1) {
    return []
  }
  const candidates = [
    ...job.notes.keyMoments.map((moment) => ({ ...moment, priority: 0 })),
    ...job.notes.chapters.map((chapter) => ({ timestamp: chapter.timestamp, reason: chapter.title, priority: 1 })),
  ]
    .filter((candidate) => candidate.timestamp >= 0 && candidate.timestamp <= job.source.duration)
    .sort((left, right) => left.timestamp - right.timestamp || left.priority - right.priority)

  const byFrame = new Map<
    string,
    { frame: FrameReference; reason: string; priority: number; candidateTimestamp: number }
  >()
  for (const candidate of candidates) {
    const frame = getFrameReference(job.source.frames, candidate.timestamp)
    if (!frame) {
      continue
    }
    const key = `${frame.sheetIndex}:${frame.column}:${frame.row}`
    if (!byFrame.has(key)) {
      byFrame.set(key, {
        frame,
        reason: candidate.reason,
        priority: candidate.priority,
        candidateTimestamp: candidate.timestamp,
      })
    }
  }
  const available = Array.from(byFrame.values())
  if (available.length <= maximum) {
    return available.sort((left, right) => left.frame.timestamp - right.frame.timestamp)
  }

  const selected: typeof available = []
  for (let index = 0; index < maximum; index += 1) {
    const target = maximum === 1 ? 0 : (job.source.duration * index) / (maximum - 1)
    const remaining = available.filter((candidate) => !selected.includes(candidate))
    remaining.sort(
      (left, right) =>
        Math.abs(left.candidateTimestamp - target) - Math.abs(right.candidateTimestamp - target) ||
        left.priority - right.priority ||
        left.candidateTimestamp - right.candidateTimestamp,
    )
    if (remaining[0]) {
      selected.push(remaining[0])
    }
  }
  return selected.sort((left, right) => left.frame.timestamp - right.frame.timestamp)
}

export const buildCourseMarkdown = (
  job: CourseJob,
  sourceUrl: string,
  images: Array<{ timestamp: number; reason: string; path: string }> = [],
  includeTranscriptLink = false,
) => {
  if (!job.notes) {
    throw new Error('课程笔记尚未完成')
  }
  const notes = job.notes
  const lines = [
    '---',
    `title: ${yamlString(notes.title)}`,
    `source: ${yamlString(sourceUrl)}`,
    `created: ${yamlString(new Date().toISOString())}`,
    'tags:',
    '  - course-notes',
    '  - bibigpt',
    '---',
    '',
    `# ${notes.title}`,
    '',
    `> [原视频](${markdownUrl(sourceUrl)})`,
    '',
    '## 课程概览',
    '',
    notes.overview,
    '',
    '## 章节笔记',
    '',
  ]

  notes.chapters.forEach((chapter) => {
    lines.push(`### ${formatTimestamp(chapter.timestamp)} ${chapter.title}`, '', chapter.summary, '')
    chapter.details.forEach((detail) => lines.push(`- ${detail}`))
    lines.push('')
  })

  lines.push('## 核心要点', '')
  notes.takeaways.forEach((takeaway) => lines.push(`- ${takeaway}`))
  lines.push('', '## 术语', '')
  notes.terms.forEach((term) => lines.push(`- **${term.term}**：${term.explanation}`))

  if (images.length > 0) {
    lines.push('', '## 关键画面', '')
    images.forEach((image) => {
      lines.push(`### ${formatTimestamp(image.timestamp)} ${image.reason}`, '', `![](${image.path})`, '')
    })
  }

  if (includeTranscriptLink) {
    lines.push('', '## 完整转写', '', '完整逐段转写见 [transcript.md](transcript.md)。', '')
  }
  return lines.join('\n')
}

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}

export async function downloadObsidianBundle(
  job: CourseJob,
  sourceUrl: string,
  existingZip?: ArrayBuffer | Blob,
): Promise<ObsidianVaultBuildResult> {
  if (!job.notes) {
    throw new Error('课程笔记尚未完成')
  }

  const exportedImages: Array<{ timestamp: number; reason: string; path: string; data: Blob }> = []
  let selectedFrameCount = 0
  if (job.source.frames) {
    const selectedFrames = selectCourseFrames(job)
    selectedFrameCount = selectedFrames.length
    for (let index = 0; index < selectedFrames.length; index += 1) {
      const { frame, reason } = selectedFrames[index]
      const filename = `${String(index + 1).padStart(2, '0')}-${formatTimestamp(frame.timestamp).replace(
        /:/g,
        '-',
      )}.jpg`
      try {
        exportedImages.push({
          timestamp: frame.timestamp,
          reason,
          path: filename,
          data: await cropFrame(frame),
        })
      } catch (error) {
        console.warn(error instanceof Error ? error.message : '关键画面导出失败')
      }
    }
  }
  if (existingZip && exportedImages.length !== selectedFrameCount) {
    throw new Error('关键画面未全部获取，已取消更新以保留现有 Vault 图片，请稍后重试')
  }

  const result = await buildObsidianVault(job, sourceUrl, exportedImages, existingZip)
  downloadBlob(result.blob, `BibiGPT-Vault-${getObsidianLessonId(job)}.zip`)
  return result
}
