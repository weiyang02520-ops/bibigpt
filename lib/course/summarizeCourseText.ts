import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateObject } from 'ai'
import {
  courseChunkRequestSchema,
  courseChunkSummarySchema,
  courseComposeRequestSchema,
  courseNotesSchema,
} from '~/lib/course/schemas'
import { selectOpenAICompatibleApiKey } from '~/lib/openai/selectOpenAICompatibleApiKey'
import { validateOpenAIBaseUrl } from '~/lib/openai/validateOpenAIBaseUrl'

type ChunkRequest = ReturnType<typeof courseChunkRequestSchema.parse>
type ComposeRequest = ReturnType<typeof courseComposeRequestSchema.parse>
type JsonRecord = Record<string, unknown>

const generateStructured = generateObject as unknown as (
  options: Record<string, unknown>,
) => Promise<{ object: unknown }>

const createProvider = (apiKey: string, baseUrl: string) =>
  createOpenAICompatible({
    name: process.env.OPENAI_COMPATIBLE_PROVIDER_NAME || 'openai-compatible',
    apiKey,
    baseURL: baseUrl,
  })

const resolveModel = async (request: ChunkRequest | ComposeRequest) => {
  const apiKey = await selectOpenAICompatibleApiKey(request.userConfig.userKey)
  const baseUrl = await validateOpenAIBaseUrl(request.userConfig.baseUrl)
  return createProvider(apiKey, baseUrl).chatModel(request.model)
}

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {}

const unwrapRecord = (value: unknown, wrapperKeys: string[]) => {
  const initial = Array.isArray(value) && value.length === 1 ? value[0] : value
  const record = asRecord(initial)
  for (const key of wrapperKeys) {
    const nested = asRecord(record[key])
    if (Object.keys(nested).length > 0) {
      return nested
    }
  }
  return record
}

const limitText = (value: unknown, maximum: number) => {
  if (typeof value === 'string') {
    return value.trim().slice(0, maximum)
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).slice(0, maximum)
  }
  return ''
}

const firstText = (record: JsonRecord, keys: string[], maximum: number) => {
  for (const key of keys) {
    const text = limitText(record[key], maximum)
    if (text) {
      return text
    }
  }
  return ''
}

const itemText = (value: unknown, maximum: number) => {
  const direct = limitText(value, maximum)
  if (direct) {
    return direct.replace(/^[-*\d.)\s]+/, '').trim()
  }
  return firstText(asRecord(value), ['text', 'point', 'detail', 'title', 'summary', 'description', 'reason'], maximum)
}

const textList = (value: unknown, maximumItems: number, maximumLength: number) => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
    ? value.split(/\r?\n/)
    : value === undefined || value === null
    ? []
    : [value]
  return values
    .map((item) => itemText(item, maximumLength))
    .filter(Boolean)
    .slice(0, maximumItems)
}

const parseTimestamp = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const text = value.trim()
  const clock = text.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/)
  if (clock) {
    return Number(clock[1] || 0) * 3600 + Number(clock[2]) * 60 + Number(clock[3])
  }
  const numeric = Number.parseFloat(text)
  return Number.isFinite(numeric) ? numeric : null
}

const clampTimestamp = (value: unknown, minimum: number, maximum: number) => {
  const timestamp = parseTimestamp(value)
  return timestamp === null ? null : Math.max(minimum, Math.min(maximum, timestamp))
}

const normalizeTerms = (value: unknown, maximumItems: number) => {
  const values = Array.isArray(value) ? value : []
  const seen = new Set<string>()
  return values
    .map((item) => {
      const record = asRecord(item)
      const term = firstText(record, ['term', 'name', 'concept'], 160)
      const explanation = firstText(record, ['explanation', 'definition', 'description', 'meaning'], 1200)
      return term && explanation ? { term, explanation } : null
    })
    .filter((item): item is { term: string; explanation: string } => {
      if (!item || seen.has(item.term.toLowerCase())) {
        return false
      }
      seen.add(item.term.toLowerCase())
      return true
    })
    .slice(0, maximumItems)
}

const normalizeKeyMoments = (value: unknown, minimum: number, maximum: number, maximumItems: number) => {
  const values = Array.isArray(value) ? value : []
  return values
    .map((item) => {
      const record = asRecord(item)
      const timestamp = clampTimestamp(
        record.timestamp ?? record.time ?? record.seconds ?? record.start,
        minimum,
        maximum,
      )
      const reason = firstText(record, ['reason', 'description', 'title', 'summary'], 800)
      return timestamp !== null && reason ? { timestamp, reason } : null
    })
    .filter((item): item is { timestamp: number; reason: string } => Boolean(item))
    .slice(0, maximumItems)
}

const normalizeChunkSummary = (value: unknown, request: ChunkRequest) => {
  const record = unwrapRecord(value, ['result', 'data', 'output', 'section', 'chunk', 'sectionSummary'])
  const keyPoints = textList(record.keyPoints ?? record.points ?? record.highlights ?? record.details, 12, 1200)
  const summary =
    firstText(record, ['summary', 'overview', 'description', 'abstract'], 4000) || keyPoints.join('\n').slice(0, 4000)
  const normalizedPoints = keyPoints.length > 0 ? keyPoints : summary ? [summary.slice(0, 1200)] : []

  return courseChunkSummarySchema.parse({
    title:
      firstText(record, ['title', 'sectionTitle', 'heading', 'name'], 240) ||
      `${request.title} (${Math.round(request.start)}-${Math.round(request.end)}s)`.slice(0, 240),
    summary,
    keyPoints: normalizedPoints,
    terms: normalizeTerms(record.terms ?? record.glossary ?? record.concepts, 16),
    keyMoments: normalizeKeyMoments(
      record.keyMoments ?? record.importantMoments ?? record.moments,
      request.start,
      request.end,
      8,
    ),
  })
}

const normalizeCourseNotes = (value: unknown, request: ComposeRequest) => {
  const record = unwrapRecord(value, ['result', 'data', 'output', 'notes', 'courseNotes'])
  const generatedChaptersValue = record.chapters ?? record.sections ?? record.outline
  const generatedChapters: unknown[] = Array.isArray(generatedChaptersValue) ? generatedChaptersValue : []
  const chapterInputs: unknown[] = generatedChapters.length > 0 ? generatedChapters : request.chunkSummaries
  const chapters = chapterInputs.slice(0, 80).map((item, index) => {
    const chapter = asRecord(item)
    const source = request.chunkSummaries[Math.min(index, request.chunkSummaries.length - 1)]
    const details = textList(chapter.details ?? chapter.keyPoints ?? chapter.points, 12, 1200)
    const summary =
      firstText(chapter, ['summary', 'overview', 'description'], 3000) ||
      source?.summary.slice(0, 3000) ||
      details.join('\n').slice(0, 3000)
    return {
      timestamp:
        clampTimestamp(chapter.timestamp ?? chapter.time ?? chapter.start, 0, request.duration) ?? source?.start ?? 0,
      title: firstText(chapter, ['title', 'heading', 'name'], 240) || source?.title || request.title.slice(0, 240),
      summary,
      details:
        details.length > 0 ? details : source?.keyPoints.slice(0, 12) || (summary ? [summary.slice(0, 1200)] : []),
    }
  })

  const fallbackTakeaways = request.chunkSummaries.flatMap((summary) => summary.keyPoints).slice(0, 30)
  const takeaways = textList(record.takeaways ?? record.keyPoints ?? record.highlights, 30, 1200)
  const providedTerms = normalizeTerms(record.terms ?? record.glossary ?? record.concepts, 60)
  const fallbackTerms = normalizeTerms(
    request.chunkSummaries.flatMap((summary) => summary.terms),
    60,
  )
  const providedMoments = normalizeKeyMoments(
    record.keyMoments ?? record.importantMoments ?? record.moments,
    0,
    request.duration,
    16,
  )
  const fallbackMoments = normalizeKeyMoments(
    request.chunkSummaries.flatMap((summary) => summary.keyMoments),
    0,
    request.duration,
    16,
  )

  return courseNotesSchema.parse({
    title: firstText(record, ['title', 'courseTitle', 'heading'], 300) || request.title.slice(0, 300),
    overview:
      firstText(record, ['overview', 'summary', 'description', 'abstract'], 6000) ||
      request.chunkSummaries
        .map((summary) => summary.summary)
        .join('\n\n')
        .slice(0, 6000),
    chapters,
    takeaways: takeaways.length > 0 ? takeaways : fallbackTakeaways,
    terms: providedTerms.length > 0 ? providedTerms : fallbackTerms,
    keyMoments:
      providedMoments.length > 0
        ? providedMoments
        : fallbackMoments.length > 0
        ? fallbackMoments
        : chapters.slice(0, 1).map((chapter) => ({ timestamp: chapter.timestamp, reason: chapter.title })),
  })
}

export async function summarizeCourseChunk(request: ChunkRequest) {
  const model = await resolveModel(request)
  const result = await generateStructured({
    model,
    output: 'no-schema',
    temperature: 0.2,
    maxOutputTokens: 3200,
    system: `You create precise study notes from timestamped course transcripts. Use only supplied evidence. Keep technical
names, commands and causal relationships. Important moments must use absolute timestamps that occur in the supplied
transcript range. Return a JSON object only. Write all human-readable fields in ${request.outputLanguage}.`,
    prompt: `Return JSON for this course section. Every property below is required. keyPoints must contain at least one
item; terms and keyMoments may be empty. timestamp values are numeric absolute seconds, not strings.

Required JSON shape:
{
  "title": "section title",
  "summary": "section summary",
  "keyPoints": ["point"],
  "terms": [{ "term": "name", "explanation": "meaning" }],
  "keyMoments": [{ "timestamp": 12.5, "reason": "why this moment matters" }]
}

Course title: ${request.title}
Section range: ${request.start} to ${request.end} seconds
Timestamped transcript:
${request.transcript}`,
  })

  return {
    start: request.start,
    end: request.end,
    ...normalizeChunkSummary(result.object, request),
  }
}

export async function composeCourseNotes(request: ComposeRequest) {
  const model = await resolveModel(request)
  const result = await generateStructured({
    model,
    output: 'no-schema',
    temperature: 0.2,
    maxOutputTokens: 7000,
    system: `You compose comprehensive study notes from ordered section summaries. Preserve coverage across the complete
duration, merge repetition, and never invent material absent from the summaries. Chapters and important moments must use
timestamps between 0 and the source duration. Return a JSON object only. Write all human-readable fields in
${request.outputLanguage}.`,
    prompt: `Return JSON for the complete course notes. Every property below is required. Keep timestamps as numeric
absolute seconds. chapters, takeaways and keyMoments must each contain at least one item; terms may be empty.

Required JSON shape:
{
  "title": "course title",
  "overview": "complete overview",
  "chapters": [{
    "timestamp": 0,
    "title": "chapter title",
    "summary": "chapter summary",
    "details": ["detail"]
  }],
  "takeaways": ["takeaway"],
  "terms": [{ "term": "name", "explanation": "meaning" }],
  "keyMoments": [{ "timestamp": 12.5, "reason": "why this moment matters" }]
}

Course title: ${request.title}
Source: ${request.sourceUrl}
Duration: ${request.duration} seconds
Ordered section summaries:
${JSON.stringify(request.chunkSummaries)}`,
  })

  return normalizeCourseNotes(result.object, request)
}
