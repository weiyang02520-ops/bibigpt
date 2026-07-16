import JSZip from 'jszip'
import { formatTimestamp } from '~/lib/course/chunkTranscript'
import { CourseJob, CourseJobStatus } from '~/lib/course/types'

export const OBSIDIAN_VAULT_ROOT = 'BibiGPT-Vault/' as const
export const OBSIDIAN_VAULT_SCHEMA_VERSION = 1 as const

const MANIFEST_PATH = 'manifest.json'
const INDEX_PATH = '00_课程索引.md'
const PROPOSAL_SUFFIX = '.bibigpt-new'
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const IDENTITY_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/
const INVALID_WINDOWS_PATH_CHARS = /[<>:"|?*\u0000-\u001f]/
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

const ARTIFACT_TYPES = ['index', 'lesson', 'transcript', 'review', 'asset'] as const
const JOB_STATUSES: CourseJobStatus[] = [
  'inspecting',
  'loading-asr',
  'transcribing',
  'summarizing',
  'composing',
  'complete',
  'cancelled',
  'failed',
]

export type ObsidianVaultArtifactType = (typeof ARTIFACT_TYPES)[number]
export type ObsidianVaultArtifactStatus = 'generated' | 'modified' | 'conflict'

export type ObsidianVaultImageAsset = {
  timestamp: number
  reason: string
  path: string
  data: Blob | Uint8Array
}

export type ObsidianVaultSourceIdentity = {
  service: string
  videoId: string
  pageNumber: number
}

export type ObsidianVaultLessonManifest = {
  lessonId: string
  title: string
  sourceUrl: string
  sourceIdentity: ObsidianVaultSourceIdentity
  sourceFingerprint: string
  sourceMode: 'captions' | 'local-asr'
  asrModel: string | null
  duration: number
  status: CourseJobStatus
  transcribedUntil: number
  transcriptSegmentCount: number
  chunkCount: number
  updatedAt: string
}

export type ObsidianVaultArtifactManifest = {
  path: string
  type: ObsidianVaultArtifactType
  lessonId?: string
  sha256: string
  status: ObsidianVaultArtifactStatus
  canonicalFilePresent?: boolean
  proposedPath?: string
  proposedSha256?: string
}

export type ObsidianVaultManifest = {
  schemaVersion: typeof OBSIDIAN_VAULT_SCHEMA_VERSION
  generator: {
    name: 'BibiGPT'
    version: 'obsidian-vault/1'
  }
  generatedAt: string
  vaultRoot: typeof OBSIDIAN_VAULT_ROOT
  lessons: ObsidianVaultLessonManifest[]
  artifacts: ObsidianVaultArtifactManifest[]
}

export type ObsidianVaultBuildResult = {
  blob: Blob
  manifest: ObsidianVaultManifest
  lessonId: string
  rootPath: typeof OBSIDIAN_VAULT_ROOT
  conflicts: ObsidianVaultArtifactManifest[]
}

type JsonRecord = Record<string, unknown>

type PreparedArtifact = {
  path: string
  type: ObsidianVaultArtifactType
  lessonId?: string
  data: Uint8Array
  sha256: string
}

const isRecord = (value: unknown): value is JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const requireString = (record: JsonRecord, key: string, context: string) => {
  const value = record[key]
  if (typeof value !== 'string' || !value) {
    throw new Error(`${context}.${key} 必须是非空字符串`)
  }
  return value
}

const requireFiniteNumber = (record: JsonRecord, key: string, context: string) => {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${context}.${key} 必须是有限数字`)
  }
  return value
}

const normalizeHttpUrl = (value: string, context: string) => {
  const normalized = value.trim()
  let parsed: URL
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`${context} 不是有效 URL`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`${context} 必须使用 HTTP 或 HTTPS`)
  }
  return normalized
}

const getPortablePathKey = (path: string) => path.normalize('NFC').toLowerCase()

const assertUniquePortablePath = (paths: Map<string, string>, path: string, context: string) => {
  const key = getPortablePathKey(path)
  const existing = paths.get(key)
  if (existing && existing !== path) {
    throw new Error(`${context} 在 Windows/macOS 上与其他路径冲突：${existing} / ${path}`)
  }
  paths.set(key, path)
}

const assertSafeRelativePath = (path: string, context: string) => {
  const segments = path.split('/')
  if (
    !path ||
    path.startsWith('/') ||
    path.includes('\\') ||
    INVALID_WINDOWS_PATH_CHARS.test(path) ||
    path.startsWith(OBSIDIAN_VAULT_ROOT) ||
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith('.') ||
        segment.endsWith(' ') ||
        WINDOWS_RESERVED_NAME.test(segment),
    )
  ) {
    throw new Error(`${context} 不是安全的 vault 相对路径：${path}`)
  }
}

const assertManagedArtifactPath = (path: string, context: string) => {
  assertSafeRelativePath(path, context)
  if (path === MANIFEST_PATH || path.endsWith(PROPOSAL_SUFFIX)) {
    throw new Error(`${context} 使用了保留路径：${path}`)
  }
}

const parseSourceIdentity = (value: unknown, context: string): ObsidianVaultSourceIdentity => {
  if (!isRecord(value)) {
    throw new Error(`${context} 必须是对象`)
  }
  const service = requireString(value, 'service', context)
  const videoId = requireString(value, 'videoId', context)
  const pageNumber = requireFiniteNumber(value, 'pageNumber', context)
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`${context}.pageNumber 必须是正整数`)
  }
  return { service, videoId, pageNumber }
}

const getLessonIdFromIdentity = (identity: ObsidianVaultSourceIdentity) => {
  if (
    !IDENTITY_TOKEN_PATTERN.test(identity.service) ||
    !IDENTITY_TOKEN_PATTERN.test(identity.videoId) ||
    !Number.isInteger(identity.pageNumber) ||
    identity.pageNumber < 1
  ) {
    throw new Error('课程来源标识不能安全地生成 lessonId')
  }
  return `${identity.service}-${identity.videoId}-p${identity.pageNumber}`
}

const parseLesson = (value: unknown, index: number): ObsidianVaultLessonManifest => {
  const context = `manifest.lessons[${index}]`
  if (!isRecord(value)) {
    throw new Error(`${context} 必须是对象`)
  }
  const status = requireString(value, 'status', context)
  if (!JOB_STATUSES.includes(status as CourseJobStatus)) {
    throw new Error(`${context}.status 无效`)
  }
  const transcribedUntil = requireFiniteNumber(value, 'transcribedUntil', context)
  const duration = requireFiniteNumber(value, 'duration', context)
  const transcriptSegmentCount = requireFiniteNumber(value, 'transcriptSegmentCount', context)
  const chunkCount = requireFiniteNumber(value, 'chunkCount', context)
  if (
    duration <= 0 ||
    transcribedUntil < 0 ||
    transcribedUntil > duration + 1 ||
    !Number.isInteger(transcriptSegmentCount) ||
    transcriptSegmentCount < 1 ||
    !Number.isInteger(chunkCount) ||
    chunkCount < 1
  ) {
    throw new Error(`${context} 的进度字段无效`)
  }
  const sourceMode = requireString(value, 'sourceMode', context)
  if (sourceMode !== 'captions' && sourceMode !== 'local-asr') {
    throw new Error(`${context}.sourceMode 无效`)
  }
  const asrModel = value.asrModel
  if (asrModel !== null && (typeof asrModel !== 'string' || !asrModel)) {
    throw new Error(`${context}.asrModel 无效`)
  }
  const lessonId = requireString(value, 'lessonId', context)
  const sourceIdentity = parseSourceIdentity(value.sourceIdentity, `${context}.sourceIdentity`)
  if (lessonId !== getLessonIdFromIdentity(sourceIdentity)) {
    throw new Error(`${context}.lessonId 与 sourceIdentity 不一致`)
  }
  return {
    lessonId,
    title: requireString(value, 'title', context),
    sourceUrl: normalizeHttpUrl(requireString(value, 'sourceUrl', context), `${context}.sourceUrl`),
    sourceIdentity,
    sourceFingerprint: requireString(value, 'sourceFingerprint', context),
    sourceMode,
    asrModel,
    duration,
    status: status as CourseJobStatus,
    transcribedUntil,
    transcriptSegmentCount,
    chunkCount,
    updatedAt: requireString(value, 'updatedAt', context),
  }
}

const parseArtifact = (value: unknown, index: number): ObsidianVaultArtifactManifest => {
  const context = `manifest.artifacts[${index}]`
  if (!isRecord(value)) {
    throw new Error(`${context} 必须是对象`)
  }
  const path = requireString(value, 'path', context)
  const type = requireString(value, 'type', context)
  const sha256 = requireString(value, 'sha256', context).toLowerCase()
  const status = requireString(value, 'status', context)
  assertManagedArtifactPath(path, `${context}.path`)
  if (!ARTIFACT_TYPES.includes(type as ObsidianVaultArtifactType)) {
    throw new Error(`${context}.type 无效`)
  }
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${context}.sha256 无效`)
  }
  if (status !== 'generated' && status !== 'modified' && status !== 'conflict') {
    throw new Error(`${context}.status 无效`)
  }

  const lessonId = value.lessonId
  if (lessonId !== undefined && (typeof lessonId !== 'string' || !lessonId)) {
    throw new Error(`${context}.lessonId 无效`)
  }
  const artifact: ObsidianVaultArtifactManifest = {
    path,
    type: type as ObsidianVaultArtifactType,
    ...(lessonId ? { lessonId } : {}),
    sha256,
    status,
  }
  if (status === 'conflict') {
    const proposedPath = requireString(value, 'proposedPath', context)
    const proposedSha256 = requireString(value, 'proposedSha256', context).toLowerCase()
    if (proposedPath !== `${path}${PROPOSAL_SUFFIX}` || !SHA256_PATTERN.test(proposedSha256)) {
      throw new Error(`${context} 的冲突提案字段无效`)
    }
    artifact.proposedPath = proposedPath
    artifact.proposedSha256 = proposedSha256
    if (value.canonicalFilePresent !== undefined && typeof value.canonicalFilePresent !== 'boolean') {
      throw new Error(`${context}.canonicalFilePresent 无效`)
    }
    artifact.canonicalFilePresent = value.canonicalFilePresent !== false
  } else if (status === 'modified') {
    if (typeof value.canonicalFilePresent !== 'boolean') {
      throw new Error(`${context}.canonicalFilePresent 无效`)
    }
    if (value.proposedPath !== undefined || value.proposedSha256 !== undefined) {
      throw new Error(`${context} 的 modified artifact 不应包含冲突提案`)
    }
    artifact.canonicalFilePresent = value.canonicalFilePresent
  } else if (
    value.proposedPath !== undefined ||
    value.proposedSha256 !== undefined ||
    value.canonicalFilePresent !== undefined
  ) {
    throw new Error(`${context} 的 generated artifact 不应包含冲突字段`)
  }
  return artifact
}

const assertArtifactOwnership = (artifact: ObsidianVaultArtifactManifest) => {
  if (artifact.type === 'index') {
    if (artifact.path !== INDEX_PATH || artifact.lessonId) {
      throw new Error(`现有 ZIP 的课程索引 artifact 无效：${artifact.path}`)
    }
    return
  }
  if (!artifact.lessonId) {
    throw new Error(`现有 ZIP 的 artifact 缺少 lessonId：${artifact.path}`)
  }
  const expectedPath =
    artifact.type === 'lesson'
      ? `lessons/${artifact.lessonId}.md`
      : artifact.type === 'transcript'
      ? `transcripts/${artifact.lessonId}.md`
      : artifact.type === 'review'
      ? `review/${artifact.lessonId}.md`
      : null
  if (expectedPath ? artifact.path !== expectedPath : !artifact.path.startsWith(`assets/${artifact.lessonId}/`)) {
    throw new Error(`现有 ZIP 的 artifact 类型与路径不匹配：${artifact.path}`)
  }
}

const parseManifest = (text: string): ObsidianVaultManifest => {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('现有 ZIP 的 BibiGPT vault manifest 不是有效 JSON')
  }
  if (!isRecord(value)) {
    throw new Error('现有 ZIP 的 BibiGPT vault manifest 必须是对象')
  }
  if (value.schemaVersion !== OBSIDIAN_VAULT_SCHEMA_VERSION) {
    throw new Error(`不支持现有 ZIP 的 manifest schemaVersion：${String(value.schemaVersion)}`)
  }
  if (value.vaultRoot !== OBSIDIAN_VAULT_ROOT) {
    throw new Error('现有 ZIP 的 manifest vaultRoot 无效')
  }
  if (
    !isRecord(value.generator) ||
    value.generator.name !== 'BibiGPT' ||
    value.generator.version !== 'obsidian-vault/1'
  ) {
    throw new Error('现有 ZIP 不是本工具生成的 BibiGPT vault')
  }
  if (!Array.isArray(value.lessons) || !Array.isArray(value.artifacts)) {
    throw new Error('现有 ZIP 的 manifest 缺少 lessons 或 artifacts')
  }

  const lessons = value.lessons.map(parseLesson)
  const artifacts = value.artifacts.map(parseArtifact)
  const lessonIds = new Set<string>()
  const portableLessonIds = new Map<string, string>()
  lessons.forEach((lesson) => {
    if (lessonIds.has(lesson.lessonId)) {
      throw new Error(`现有 ZIP 的 manifest 含重复 lessonId：${lesson.lessonId}`)
    }
    assertUniquePortablePath(portableLessonIds, lesson.lessonId, '现有 ZIP 的 lessonId')
    lessonIds.add(lesson.lessonId)
  })
  const artifactPaths = new Set<string>()
  const portableArtifactPaths = new Map<string, string>()
  artifacts.forEach((artifact) => {
    if (artifactPaths.has(artifact.path)) {
      throw new Error(`现有 ZIP 的 manifest 含重复 artifact path：${artifact.path}`)
    }
    assertUniquePortablePath(portableArtifactPaths, artifact.path, '现有 ZIP 的 artifact path')
    artifactPaths.add(artifact.path)
    assertArtifactOwnership(artifact)
    if (artifact.lessonId && !lessonIds.has(artifact.lessonId)) {
      throw new Error(`现有 ZIP 的 artifact 引用了未知 lessonId：${artifact.lessonId}`)
    }
  })
  if (!artifacts.some((artifact) => artifact.type === 'index' && artifact.path === INDEX_PATH)) {
    throw new Error('现有 ZIP 的 manifest 缺少课程索引 artifact')
  }
  lessons.forEach((lesson) => {
    const requiredPaths = [
      `lessons/${lesson.lessonId}.md`,
      `transcripts/${lesson.lessonId}.md`,
      `review/${lesson.lessonId}.md`,
    ]
    requiredPaths.forEach((path) => {
      if (!artifactPaths.has(path)) {
        throw new Error(`现有 ZIP 的 manifest 缺少 lesson artifact：${path}`)
      }
    })
  })

  return {
    schemaVersion: OBSIDIAN_VAULT_SCHEMA_VERSION,
    generator: { name: 'BibiGPT', version: 'obsidian-vault/1' },
    generatedAt: requireString(value, 'generatedAt', 'manifest'),
    vaultRoot: OBSIDIAN_VAULT_ROOT,
    lessons,
    artifacts,
  }
}

const toBytes = async (value: string | Blob | Uint8Array) => {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value)
  }
  return new Uint8Array(await value.arrayBuffer())
}

const sha256 = async (data: Uint8Array) => {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前环境不支持 Web Crypto SHA-256')
  }
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const prepareArtifact = async (
  path: string,
  type: ObsidianVaultArtifactType,
  data: string | Blob | Uint8Array,
  lessonId?: string,
): Promise<PreparedArtifact> => {
  assertManagedArtifactPath(path, 'artifact path')
  const bytes = await toBytes(data)
  return { path, type, lessonId, data: bytes, sha256: await sha256(bytes) }
}

const singleLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim()
const yamlString = (value: string) => JSON.stringify(singleLine(value))
const inlineCode = (value: string) => singleLine(value).replace(/`/g, "'")
const markdownText = (value: string) => singleLine(value).replace(/([\\`*_[\]<>])/g, '\\$1')
const externalMarkdownUrl = (value: string) => `<${value.replace(/</g, '%3C').replace(/>/g, '%3E')}>`
const localMarkdownUrl = (value: string) => value.split('/').map(encodeURIComponent).join('/')

const identityEquals = (left: ObsidianVaultSourceIdentity, right: ObsidianVaultSourceIdentity) =>
  left.service === right.service && left.videoId === right.videoId && left.pageNumber === right.pageNumber

export const getObsidianLessonId = (job: Pick<CourseJob, 'source'>) => {
  const { service, videoId, pageNumber } = job.source
  return getLessonIdFromIdentity({ service, videoId, pageNumber })
}

const validateBuildInput = (job: CourseJob, sourceUrl: string) => {
  if (job.status !== 'complete' || !job.notes) {
    throw new Error('只有已完成的课程笔记可以导出 Vault')
  }
  if (
    !job.sourceFingerprint.trim() ||
    !job.source.title.trim() ||
    !job.notes.title.trim() ||
    !job.notes.overview.trim()
  ) {
    throw new Error('课程任务缺少来源指纹、标题或概览')
  }
  if (!Number.isFinite(job.source.duration) || job.source.duration <= 0) {
    throw new Error('课程时长无效')
  }
  if (
    !Number.isFinite(job.transcribedUntil) ||
    job.transcribedUntil < 0 ||
    job.transcribedUntil > job.source.duration + 1
  ) {
    throw new Error('课程转写游标无效')
  }
  if (job.source.mode !== 'captions' && job.source.mode !== 'local-asr') {
    throw new Error('课程来源模式无效')
  }
  if (job.source.mode === 'local-asr' && !job.asrModel?.trim()) {
    throw new Error('本地 ASR 课程缺少模型标识')
  }
  if (job.asrModel !== undefined && job.asrModel !== null && !job.asrModel.trim()) {
    throw new Error('ASR 模型标识无效')
  }
  if (!Array.isArray(job.transcript) || job.transcript.length < 1) {
    throw new Error('课程转写为空')
  }
  const segmentIds = new Set<string>()
  job.transcript.forEach((segment, index) => {
    if (
      !segment.id?.trim() ||
      segmentIds.has(segment.id) ||
      !segment.text?.trim() ||
      (segment.source !== 'caption' && segment.source !== 'asr') ||
      !Number.isFinite(segment.start) ||
      !Number.isFinite(segment.end) ||
      segment.start < 0 ||
      segment.end < segment.start ||
      segment.end > job.source.duration + 1
    ) {
      throw new Error(`课程转写片段无效：${index}`)
    }
    segmentIds.add(segment.id)
  })
  if (!Array.isArray(job.chunkSummaries) || job.chunkSummaries.length < 1) {
    throw new Error('课程分段总结为空')
  }
  job.chunkSummaries.forEach((chunk, index) => {
    if (
      !chunk.title?.trim() ||
      !chunk.summary?.trim() ||
      !Number.isFinite(chunk.start) ||
      !Number.isFinite(chunk.end) ||
      chunk.start < 0 ||
      chunk.end <= chunk.start ||
      chunk.end > job.source.duration + 1
    ) {
      throw new Error(`课程分段总结无效：${index}`)
    }
  })
  if (!Array.isArray(job.notes.chapters) || job.notes.chapters.length < 1) {
    throw new Error('课程章节笔记为空')
  }
  const archiveDate = new Date(job.updatedAt)
  if (Number.isNaN(archiveDate.getTime())) {
    throw new Error('job.updatedAt 不是有效时间')
  }
  getObsidianLessonId(job)
  return { archiveDate, sourceUrl: normalizeHttpUrl(sourceUrl, 'sourceUrl') }
}

const normalizeAssetPath = (inputPath: string, lessonId: string) => {
  let path = inputPath.replace(/\\/g, '/').trim()
  if (path.startsWith(OBSIDIAN_VAULT_ROOT)) {
    path = path.slice(OBSIDIAN_VAULT_ROOT.length)
  }
  const prefix = `assets/${lessonId}/`
  if (path.startsWith('assets/') && !path.startsWith(prefix)) {
    throw new Error(`图片路径不属于当前 lesson：${inputPath}`)
  }
  path = path.startsWith(prefix) ? path : `${prefix}${path}`
  assertManagedArtifactPath(path, '图片路径')
  return path
}

const buildLessonMarkdown = (
  job: CourseJob,
  sourceUrl: string,
  lessonId: string,
  assets: Array<ObsidianVaultImageAsset & { normalizedPath: string }>,
) => {
  if (!job.notes) {
    throw new Error('课程笔记尚未完成')
  }
  const notes = job.notes
  const lines = [
    '---',
    `lessonId: ${yamlString(lessonId)}`,
    `title: ${yamlString(notes.title)}`,
    `source: ${yamlString(sourceUrl)}`,
    `service: ${yamlString(job.source.service)}`,
    `videoId: ${yamlString(job.source.videoId)}`,
    `pageNumber: ${job.source.pageNumber}`,
    `updatedAt: ${yamlString(job.updatedAt)}`,
    'tags:',
    '  - course-notes',
    '  - bibigpt',
    '---',
    '',
    `# ${markdownText(notes.title)}`,
    '',
    '## Source',
    '',
    `- [原视频](${externalMarkdownUrl(sourceUrl)})`,
    `- 来源标识：\`${inlineCode(job.source.service)} / ${inlineCode(job.source.videoId)} / P${job.source.pageNumber}\``,
    '',
    '## 课程概览',
    '',
    notes.overview,
    '',
    '## 章节笔记',
    '',
  ]

  notes.chapters.forEach((chapter) => {
    lines.push(`### ${formatTimestamp(chapter.timestamp)} ${markdownText(chapter.title)}`, '', chapter.summary, '')
    chapter.details.forEach((detail) => lines.push(`- ${detail}`))
    lines.push('')
  })
  lines.push('## 核心要点', '')
  notes.takeaways.forEach((takeaway) => lines.push(`- ${takeaway}`))
  lines.push('', '## 术语', '')
  if (notes.terms.length > 0) {
    notes.terms.forEach((term) => lines.push(`- **${term.term}**：${term.explanation}`))
  } else {
    lines.push('- 本课暂无独立术语条目。')
  }

  if (assets.length > 0) {
    lines.push('', '## 关键画面', '')
    assets.forEach((asset) => {
      const relativePath = `../${asset.normalizedPath}`
      lines.push(
        `### ${formatTimestamp(asset.timestamp)} ${markdownText(asset.reason)}`,
        '',
        `![${markdownText(asset.reason)}](${localMarkdownUrl(relativePath)})`,
        '',
      )
    })
  }

  lines.push(
    '',
    '## 相关材料',
    '',
    `- [完整逐段转写](${localMarkdownUrl(`../transcripts/${lessonId}.md`)})`,
    `- [复习与自测](${localMarkdownUrl(`../review/${lessonId}.md`)})`,
    '',
  )
  return lines.join('\n')
}

const buildTranscriptMarkdown = (job: CourseJob, sourceUrl: string, lessonId: string) => {
  const lines = [
    '---',
    `lessonId: ${yamlString(lessonId)}`,
    `source: ${yamlString(sourceUrl)}`,
    `updatedAt: ${yamlString(job.updatedAt)}`,
    '---',
    '',
    `# ${markdownText(job.source.title)} - 完整逐段转写`,
    '',
    `> [原视频](${externalMarkdownUrl(sourceUrl)})`,
    '',
  ]
  const transcript = [...job.transcript].sort(
    (left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id),
  )
  transcript.forEach((segment) => {
    lines.push(
      `## ${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}`,
      '',
      `- source: \`${segment.source}\``,
      `- segment id: \`${inlineCode(segment.id)}\``,
      '',
      segment.text,
      '',
    )
  })
  return lines.join('\n')
}

const buildReviewMarkdown = (job: CourseJob, sourceUrl: string, lessonId: string) => {
  if (!job.notes) {
    throw new Error('课程笔记尚未完成')
  }
  const notes = job.notes
  const lines = [
    '---',
    `lessonId: ${yamlString(lessonId)}`,
    `source: ${yamlString(sourceUrl)}`,
    `updatedAt: ${yamlString(job.updatedAt)}`,
    '---',
    '',
    `# ${markdownText(notes.title)} - 复习与自测`,
    '',
    '## 复习清单',
    '',
  ]
  notes.chapters.forEach((chapter) =>
    lines.push(`- [ ] 回顾 ${formatTimestamp(chapter.timestamp)} ${markdownText(chapter.title)}`),
  )
  notes.takeaways.forEach((takeaway) => lines.push(`- [ ] 能够复述：${takeaway}`))
  notes.terms.forEach((term) => lines.push(`- [ ] 能够解释术语：${term.term}`))

  lines.push('', '## 自测问题', '', '### 按章节', '')
  notes.chapters.forEach((chapter, index) => {
    lines.push(`${index + 1}. ${chapter.title} 的核心结论是什么？它与本课其他章节如何衔接？`)
  })
  lines.push('', '### 按术语', '')
  if (notes.terms.length > 0) {
    notes.terms.forEach((term, index) => {
      lines.push(`${index + 1}. 什么是“${term.term}”？请不用原文解释，并给出一个应用场景。`)
    })
  } else {
    lines.push('1. 从课程中选出一个关键概念，给出定义、用途和一个反例。')
  }
  lines.push('')
  return lines.join('\n')
}

const buildIndexMarkdown = (lessons: ObsidianVaultLessonManifest[], generatedAt: string) => {
  const lines = [
    '---',
    'generator: BibiGPT',
    `generatedAt: ${yamlString(generatedAt)}`,
    '---',
    '',
    '# BibiGPT 课程索引',
    '',
  ]
  lessons.forEach((lesson) => {
    lines.push(
      `## [${markdownText(lesson.title)}](${localMarkdownUrl(`lessons/${lesson.lessonId}.md`)})`,
      '',
      `- Source: [${inlineCode(lesson.sourceIdentity.service)} / ${inlineCode(lesson.sourceIdentity.videoId)} / P${
        lesson.sourceIdentity.pageNumber
      }](${externalMarkdownUrl(lesson.sourceUrl)})`,
      `- 状态：\`${lesson.status}\``,
      `- 转写进度：${formatTimestamp(lesson.transcribedUntil)}`,
      `- 分段数量：${lesson.chunkCount}`,
      `- 更新：\`${inlineCode(lesson.updatedAt)}\``,
      '',
    )
  })
  return lines.join('\n')
}

const getZipFile = (zip: JSZip, relativePath: string) => zip.file(`${OBSIDIAN_VAULT_ROOT}${relativePath}`)

const hashZipFile = async (file: JSZip.JSZipObject) => sha256(await file.async('uint8array'))

const writeZipFile = (zip: JSZip, artifact: PreparedArtifact, date: Date) => {
  zip.file(`${OBSIDIAN_VAULT_ROOT}${artifact.path}`, artifact.data, { date, createFolders: false })
}

const writeProposal = async (
  zip: JSZip,
  artifact: PreparedArtifact,
  oldArtifact: ObsidianVaultArtifactManifest | undefined,
  date: Date,
) => {
  const proposedPath = `${artifact.path}${PROPOSAL_SUFFIX}`
  const existingProposal = getZipFile(zip, proposedPath)
  if (existingProposal) {
    const existingHash = await hashZipFile(existingProposal)
    const expectedHash =
      oldArtifact?.status === 'conflict' && oldArtifact.proposedPath === proposedPath
        ? oldArtifact.proposedSha256
        : undefined
    if (existingHash !== expectedHash && existingHash !== artifact.sha256) {
      throw new Error(`冲突提案也已被编辑，无法安全更新：${proposedPath}`)
    }
  }
  zip.file(`${OBSIDIAN_VAULT_ROOT}${proposedPath}`, artifact.data, { date, createFolders: false })
  return proposedPath
}

const mergeArtifact = async (
  zip: JSZip,
  artifact: PreparedArtifact,
  oldArtifact: ObsidianVaultArtifactManifest | undefined,
  date: Date,
): Promise<ObsidianVaultArtifactManifest> => {
  const existingFile = getZipFile(zip, artifact.path)
  const existingHash = existingFile ? await hashZipFile(existingFile) : null
  const canOverwrite =
    (!oldArtifact && !existingFile) ||
    (oldArtifact?.status === 'generated' && existingHash !== null && existingHash === oldArtifact.sha256)

  if (canOverwrite) {
    writeZipFile(zip, artifact, date)
    return {
      path: artifact.path,
      type: artifact.type,
      ...(artifact.lessonId ? { lessonId: artifact.lessonId } : {}),
      sha256: artifact.sha256,
      status: 'generated',
    }
  }

  const proposedPath = await writeProposal(zip, artifact, oldArtifact, date)
  return {
    path: artifact.path,
    type: artifact.type,
    ...(artifact.lessonId ? { lessonId: artifact.lessonId } : {}),
    sha256: existingHash || oldArtifact?.sha256 || artifact.sha256,
    status: 'conflict',
    canonicalFilePresent: existingFile !== null,
    proposedPath,
    proposedSha256: artifact.sha256,
  }
}

const removeUnchangedStaleArtifact = async (zip: JSZip, artifact: ObsidianVaultArtifactManifest) => {
  const file = getZipFile(zip, artifact.path)
  if (artifact.status === 'generated' && file && (await hashZipFile(file)) === artifact.sha256) {
    zip.remove(`${OBSIDIAN_VAULT_ROOT}${artifact.path}`)
  }
  if (artifact.status === 'conflict' && artifact.proposedPath && artifact.proposedSha256) {
    const proposal = getZipFile(zip, artifact.proposedPath)
    if (proposal && (await hashZipFile(proposal)) === artifact.proposedSha256) {
      zip.remove(`${OBSIDIAN_VAULT_ROOT}${artifact.proposedPath}`)
    }
  }
}

const inspectExistingEntries = (zip: JSZip) => {
  const portableEntries = new Map<string, string>()
  Object.values(zip.files).forEach((entry) => {
    if (entry.unsafeOriginalName && entry.unsafeOriginalName !== entry.name) {
      throw new Error(`现有 ZIP 含不安全路径：${entry.unsafeOriginalName}`)
    }
    if (entry.name !== OBSIDIAN_VAULT_ROOT && !entry.name.startsWith(OBSIDIAN_VAULT_ROOT)) {
      throw new Error(`现有 ZIP 含 vault 根目录外的文件：${entry.name}`)
    }
    if (entry.name === OBSIDIAN_VAULT_ROOT) {
      return
    }
    const relativePath = entry.name.slice(OBSIDIAN_VAULT_ROOT.length).replace(/\/$/, '')
    assertSafeRelativePath(relativePath, '现有 ZIP 的条目路径')
    assertUniquePortablePath(portableEntries, relativePath, '现有 ZIP 的条目路径')
  })
  return portableEntries
}

const refreshArtifactStates = async (zip: JSZip, manifest: ObsidianVaultManifest) => {
  const artifacts: ObsidianVaultArtifactManifest[] = []
  for (const artifact of manifest.artifacts) {
    const canonical = getZipFile(zip, artifact.path)
    const canonicalHash = canonical ? await hashZipFile(canonical) : null
    if (artifact.status === 'generated') {
      artifacts.push(
        canonicalHash === artifact.sha256
          ? artifact
          : {
              ...artifact,
              sha256: canonicalHash || artifact.sha256,
              status: 'modified',
              canonicalFilePresent: canonical !== null,
            },
      )
      continue
    }

    if (artifact.status === 'conflict' && artifact.proposedPath && artifact.proposedSha256) {
      const proposal = getZipFile(zip, artifact.proposedPath)
      if (proposal && (await hashZipFile(proposal)) !== artifact.proposedSha256) {
        throw new Error(`冲突提案已被编辑，无法安全合并：${artifact.proposedPath}`)
      }
      if (proposal) {
        artifacts.push({
          ...artifact,
          sha256: canonicalHash || artifact.sha256,
          canonicalFilePresent: canonical !== null,
        })
        continue
      }
    }

    artifacts.push({
      path: artifact.path,
      type: artifact.type,
      ...(artifact.lessonId ? { lessonId: artifact.lessonId } : {}),
      sha256: canonicalHash || artifact.sha256,
      status: 'modified',
      canonicalFilePresent: canonical !== null,
    })
  }
  return { ...manifest, artifacts }
}

const loadExistingVault = async (existingZip: ArrayBuffer | Blob) => {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(existingZip instanceof Blob ? await existingZip.arrayBuffer() : existingZip)
  } catch {
    throw new Error('现有 ZIP 无法解析')
  }
  const portableEntries = inspectExistingEntries(zip)
  const manifestFile = getZipFile(zip, MANIFEST_PATH)
  if (!manifestFile) {
    throw new Error('现有 ZIP 没有有效的 BibiGPT vault manifest，拒绝猜测合并')
  }
  const manifest = await refreshArtifactStates(zip, parseManifest(await manifestFile.async('string')))
  return { zip, manifest, portableEntries }
}

const createLessonManifest = (job: CourseJob, sourceUrl: string, lessonId: string): ObsidianVaultLessonManifest => ({
  lessonId,
  title: job.notes?.title || job.source.title,
  sourceUrl,
  sourceIdentity: {
    service: job.source.service,
    videoId: job.source.videoId,
    pageNumber: job.source.pageNumber,
  },
  sourceFingerprint: job.sourceFingerprint,
  sourceMode: job.source.mode,
  asrModel: job.asrModel || null,
  duration: job.source.duration,
  status: job.status,
  transcribedUntil: job.transcribedUntil,
  transcriptSegmentCount: job.transcript.length,
  chunkCount: job.chunkSummaries.length,
  updatedAt: job.updatedAt,
})

/** Build a new BibiGPT vault ZIP or merge one lesson into an existing vault ZIP. */
export async function buildObsidianVault(
  job: CourseJob,
  sourceUrl: string,
  imageAssets: ObsidianVaultImageAsset[] = [],
  existingZip?: ArrayBuffer | Blob,
): Promise<ObsidianVaultBuildResult> {
  const { archiveDate, sourceUrl: normalizedSourceUrl } = validateBuildInput(job, sourceUrl)

  const lessonId = getObsidianLessonId(job)
  const normalizedAssets = imageAssets
    .map((asset) => ({ ...asset, normalizedPath: normalizeAssetPath(asset.path, lessonId) }))
    .sort((left, right) => left.timestamp - right.timestamp || left.normalizedPath.localeCompare(right.normalizedPath))
  const assetPaths = new Map<string, string>()
  normalizedAssets.forEach((asset) => {
    if (
      !Number.isFinite(asset.timestamp) ||
      asset.timestamp < 0 ||
      asset.timestamp > job.source.duration ||
      !asset.reason.trim()
    ) {
      throw new Error(`图片元数据无效：${asset.path}`)
    }
    assertUniquePortablePath(assetPaths, asset.normalizedPath, '图片路径')
  })

  const loaded = existingZip ? await loadExistingVault(existingZip) : null
  const zip = loaded?.zip || new JSZip()
  const oldManifest = loaded?.manifest
  const currentIdentity: ObsidianVaultSourceIdentity = {
    service: job.source.service,
    videoId: job.source.videoId,
    pageNumber: job.source.pageNumber,
  }
  const oldLesson = oldManifest?.lessons.find((lesson) => lesson.lessonId === lessonId)
  if (oldLesson && !identityEquals(oldLesson.sourceIdentity, currentIdentity)) {
    throw new Error(`lessonId 与现有来源身份冲突：${lessonId}`)
  }

  const lesson = createLessonManifest(job, normalizedSourceUrl, lessonId)
  const lessons = [...(oldManifest?.lessons.filter((item) => item.lessonId !== lessonId) || []), lesson].sort(
    (left, right) => left.lessonId.localeCompare(right.lessonId),
  )
  const portableLessonIds = new Map<string, string>()
  lessons.forEach((item) => assertUniquePortablePath(portableLessonIds, item.lessonId, 'lessonId'))

  const prepared = await Promise.all([
    prepareArtifact(
      `lessons/${lessonId}.md`,
      'lesson',
      buildLessonMarkdown(job, normalizedSourceUrl, lessonId, normalizedAssets),
      lessonId,
    ),
    prepareArtifact(
      `transcripts/${lessonId}.md`,
      'transcript',
      buildTranscriptMarkdown(job, normalizedSourceUrl, lessonId),
      lessonId,
    ),
    prepareArtifact(
      `review/${lessonId}.md`,
      'review',
      buildReviewMarkdown(job, normalizedSourceUrl, lessonId),
      lessonId,
    ),
    ...normalizedAssets.map((asset) => prepareArtifact(asset.normalizedPath, 'asset', asset.data, lessonId)),
    prepareArtifact(INDEX_PATH, 'index', buildIndexMarkdown(lessons, job.updatedAt)),
  ])
  const portablePreparedPaths = new Map<string, string>()
  prepared.forEach((artifact) => {
    assertUniquePortablePath(portablePreparedPaths, artifact.path, '新生成的 artifact path')
    const existingPath = loaded?.portableEntries.get(getPortablePathKey(artifact.path))
    if (existingPath && existingPath !== artifact.path) {
      throw new Error(`新生成路径与现有 ZIP 路径发生跨平台冲突：${existingPath} / ${artifact.path}`)
    }
    const proposedPath = `${artifact.path}${PROPOSAL_SUFFIX}`
    const existingProposalPath = loaded?.portableEntries.get(getPortablePathKey(proposedPath))
    if (existingProposalPath && existingProposalPath !== proposedPath) {
      throw new Error(`冲突提案路径与现有 ZIP 路径发生跨平台冲突：${existingProposalPath} / ${proposedPath}`)
    }
  })

  const newPaths = new Set(prepared.map((artifact) => artifact.path))
  const oldArtifacts = oldManifest?.artifacts || []
  const oldArtifactByPath = new Map(oldArtifacts.map((artifact) => [artifact.path, artifact]))
  for (const artifact of oldArtifacts) {
    if (artifact.lessonId === lessonId && !newPaths.has(artifact.path)) {
      await removeUnchangedStaleArtifact(zip, artifact)
    }
  }

  const retainedArtifacts = oldArtifacts.filter(
    (artifact) => artifact.lessonId !== lessonId && artifact.type !== 'index',
  )
  const mergedArtifacts: ObsidianVaultArtifactManifest[] = []
  for (const artifact of prepared) {
    const oldArtifact = oldArtifactByPath.get(artifact.path)
    if (oldArtifact?.lessonId && oldArtifact.lessonId !== artifact.lessonId) {
      throw new Error(`artifact path 与其他 lesson 冲突：${artifact.path}`)
    }
    mergedArtifacts.push(await mergeArtifact(zip, artifact, oldArtifact, archiveDate))
  }

  const artifacts = [...retainedArtifacts, ...mergedArtifacts].sort((left, right) =>
    left.path.localeCompare(right.path),
  )
  const portableArtifactPaths = new Map<string, string>()
  artifacts.forEach((artifact) =>
    assertUniquePortablePath(portableArtifactPaths, artifact.path, '最终 manifest artifact path'),
  )
  const manifest: ObsidianVaultManifest = {
    schemaVersion: OBSIDIAN_VAULT_SCHEMA_VERSION,
    generator: { name: 'BibiGPT', version: 'obsidian-vault/1' },
    generatedAt: job.updatedAt,
    vaultRoot: OBSIDIAN_VAULT_ROOT,
    lessons,
    artifacts,
  }
  const manifestBytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`)
  zip.file(`${OBSIDIAN_VAULT_ROOT}${MANIFEST_PATH}`, manifestBytes, { date: archiveDate, createFolders: false })

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/zip',
    platform: 'UNIX',
  })
  return {
    blob,
    manifest,
    lessonId,
    rootPath: OBSIDIAN_VAULT_ROOT,
    conflicts: artifacts.filter((artifact) => artifact.status !== 'generated'),
  }
}
