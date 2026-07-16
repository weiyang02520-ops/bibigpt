import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { posix as path } from 'node:path'
import JSZip from 'jszip'

const ROOT = 'BibiGPT-Vault/'
const MANIFEST_PATH = `${ROOT}manifest.json`
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const INVALID_WINDOWS_PATH_CHARS = /[<>:"|?*\u0000-\u001f]/
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

const fail = (message) => {
  throw new Error(message)
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex')
const portablePathKey = (value) => value.normalize('NFC').toLowerCase()

const requireFile = (zip, name) => {
  const file = zip.file(name)
  if (!file) fail(`ZIP 缺少文件：${name}`)
  return file
}

const assertMarkdownLinks = async (zip, filename) => {
  const markdown = await requireFile(zip, filename).async('string')
  const links = markdown.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)
  for (const match of links) {
    let target = match[1].trim().replace(/^<|>$/g, '').split('#')[0]
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue
    try {
      target = decodeURI(target)
    } catch {
      fail(`${filename} 含无效 URL 编码：${target}`)
    }
    const resolved = path.normalize(path.join(path.dirname(filename), target))
    if (!resolved.startsWith(ROOT) || !zip.file(resolved)) {
      fail(`${filename} 的本地链接无效：${target}`)
    }
  }
}

const archivePath = process.argv[2]
if (!archivePath) {
  fail('用法：node scripts/validate-obsidian-vault.mjs <vault.zip>')
}

const zip = await JSZip.loadAsync(await readFile(archivePath))
const portableEntries = new Map()
for (const entry of Object.values(zip.files)) {
  if (entry.name !== ROOT && !entry.name.startsWith(ROOT)) {
    fail(`ZIP 含 Vault 根目录外的条目：${entry.name}`)
  }
  if (entry.name === ROOT) continue
  const relativePath = entry.name.slice(ROOT.length).replace(/\/$/, '')
  const segments = relativePath.split('/')
  if (
    !relativePath ||
    relativePath.includes('\\') ||
    INVALID_WINDOWS_PATH_CHARS.test(relativePath) ||
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
    fail(`ZIP 含跨平台不安全路径：${entry.name}`)
  }
  const key = portablePathKey(relativePath)
  const collision = portableEntries.get(key)
  if (collision && collision !== relativePath) {
    fail(`ZIP 含 Windows/macOS 路径冲突：${collision} / ${relativePath}`)
  }
  portableEntries.set(key, relativePath)
}

const manifest = JSON.parse(await requireFile(zip, MANIFEST_PATH).async('string'))
if (manifest.schemaVersion !== 1 || manifest.vaultRoot !== ROOT) {
  fail('manifest schemaVersion 或 vaultRoot 无效')
}
if (manifest.generator?.name !== 'BibiGPT' || manifest.generator?.version !== 'obsidian-vault/1') {
  fail('manifest generator 无效')
}
if (!Array.isArray(manifest.lessons) || !Array.isArray(manifest.artifacts)) {
  fail('manifest lessons 或 artifacts 无效')
}

const lessonIds = new Set()
const portableLessonIds = new Map()
for (const lesson of manifest.lessons) {
  const identity = lesson.sourceIdentity
  const expectedId = `${identity?.service}-${identity?.videoId}-p${identity?.pageNumber}`
  if (!lesson.lessonId || lesson.lessonId !== expectedId || lessonIds.has(lesson.lessonId)) {
    fail(`lessonId 无效或重复：${lesson.lessonId}`)
  }
  const portableId = portablePathKey(lesson.lessonId)
  if (portableLessonIds.has(portableId)) fail(`lessonId 存在跨平台冲突：${lesson.lessonId}`)
  portableLessonIds.set(portableId, lesson.lessonId)
  if (
    !['captions', 'local-asr'].includes(lesson.sourceMode) ||
    !Number.isFinite(lesson.duration) ||
    lesson.duration <= 0 ||
    !Number.isInteger(lesson.transcriptSegmentCount) ||
    lesson.transcriptSegmentCount < 1 ||
    !Number.isInteger(lesson.chunkCount) ||
    lesson.chunkCount < 1
  ) {
    fail(`lesson 工作流元数据无效：${lesson.lessonId}`)
  }
  lessonIds.add(lesson.lessonId)
}

const artifactPaths = new Set()
const portableArtifactPaths = new Map()
const markdownFiles = new Set()
for (const artifact of manifest.artifacts) {
  if (!artifact.path || artifactPaths.has(artifact.path)) {
    fail(`artifact path 缺失或重复：${artifact.path}`)
  }
  const portableArtifactPath = portablePathKey(artifact.path)
  if (portableArtifactPaths.has(portableArtifactPath)) {
    fail(`artifact path 存在跨平台冲突：${artifact.path}`)
  }
  portableArtifactPaths.set(portableArtifactPath, artifact.path)
  artifactPaths.add(artifact.path)
  if (!SHA256_PATTERN.test(artifact.sha256 || '')) {
    fail(`artifact sha256 无效：${artifact.path}`)
  }
  const canonicalName = `${ROOT}${artifact.path}`
  const canonical = zip.file(canonicalName)
  if (artifact.status === 'generated') {
    const actualHash = sha256(await requireFile(zip, canonicalName).async('nodebuffer'))
    if (actualHash !== artifact.sha256) fail(`artifact hash 不匹配：${artifact.path}`)
  } else if (artifact.status === 'modified') {
    if (Boolean(canonical) !== artifact.canonicalFilePresent) {
      fail(`modified canonicalFilePresent 不匹配：${artifact.path}`)
    }
    if (canonical && sha256(await canonical.async('nodebuffer')) !== artifact.sha256) {
      fail(`modified canonical hash 不匹配：${artifact.path}`)
    }
  } else if (artifact.status === 'conflict') {
    if (artifact.proposedPath !== `${artifact.path}.bibigpt-new`) {
      fail(`冲突提案路径无效：${artifact.path}`)
    }
    const proposedName = `${ROOT}${artifact.proposedPath}`
    const proposedHash = sha256(await requireFile(zip, proposedName).async('nodebuffer'))
    if (proposedHash !== artifact.proposedSha256) fail(`冲突提案 hash 不匹配：${artifact.path}`)
    if (Boolean(canonical) !== (artifact.canonicalFilePresent !== false)) {
      fail(`冲突 canonicalFilePresent 不匹配：${artifact.path}`)
    }
    if (canonical && sha256(await canonical.async('nodebuffer')) !== artifact.sha256) {
      fail(`冲突 canonical hash 不匹配：${artifact.path}`)
    }
    if (artifact.proposedPath.endsWith('.md.bibigpt-new')) markdownFiles.add(proposedName)
  } else {
    fail(`artifact status 无效：${artifact.path}`)
  }
  if (artifact.path.endsWith('.md') && canonical) markdownFiles.add(canonicalName)
}

if (!artifactPaths.has('00_课程索引.md')) fail('manifest 缺少课程索引')
if (artifactPaths.has('manifest.json')) fail('manifest.json 不应列入 artifacts')
for (const lessonId of lessonIds) {
  for (const relativePath of [`lessons/${lessonId}.md`, `transcripts/${lessonId}.md`, `review/${lessonId}.md`]) {
    if (!artifactPaths.has(relativePath)) fail(`manifest 缺少课程文件：${relativePath}`)
  }
}
for (const filename of markdownFiles) await assertMarkdownLinks(zip, filename)

console.log(
  JSON.stringify({
    archive: archivePath,
    lessons: manifest.lessons.length,
    artifacts: manifest.artifacts.length,
    modified: manifest.artifacts.filter((artifact) => artifact.status === 'modified').length,
    conflicts: manifest.artifacts.filter((artifact) => artifact.status === 'conflict').length,
  }),
)
