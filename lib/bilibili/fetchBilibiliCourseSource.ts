import { CourseAudioSource, CourseFrameManifest, CourseSource, TranscriptSegment } from '~/lib/course/types'
import { VideoService } from '~/lib/types'

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toPositiveInteger = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const toFiniteNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : null
}

const toHttpsUrl = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Bilibili 返回了无效资源地址')
  }

  const absoluteValue = value.startsWith('//') ? `https:${value}` : value
  const parsed = new URL(absoluteValue)
  if (parsed.protocol !== 'https:') {
    throw new Error('Bilibili 返回了非 HTTPS 资源地址')
  }
  return parsed.toString()
}

const getSessionToken = () =>
  (process.env.BILIBILI_SESSION_TOKEN || '')
    .split(',')
    .map((token) => token.trim())
    .find(Boolean)

const createHeaders = () => {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36',
  }
  const sessionToken = getSessionToken()
  if (sessionToken) {
    headers.Cookie = `SESSDATA=${sessionToken}`
  }
  return headers
}

const fetchJson = async (url: string, requestName: string): Promise<JsonObject> => {
  let response: Response
  try {
    response = await fetch(url, {
      headers: createHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    })
  } catch {
    throw new Error(`无法连接 Bilibili，${requestName}请求失败`)
  }

  if (!response.ok) {
    throw new Error(`Bilibili ${requestName}请求失败（HTTP ${response.status}）`)
  }

  const json: unknown = await response.json()
  if (!isJsonObject(json) || json.code !== 0 || !isJsonObject(json.data)) {
    const code = isJsonObject(json) && typeof json.code === 'number' ? json.code : 'unknown'
    throw new Error(`Bilibili ${requestName}响应异常（业务码 ${code}）`)
  }

  return json.data
}

const parsePreviewTimestamps = (buffer: ArrayBuffer, duration: number): number[] => {
  const bytes = new Uint8Array(buffer)
  const parse = (width: 2 | 4) => {
    if (bytes.length % width !== 0) {
      return []
    }
    const view = new DataView(buffer)
    return Array.from({ length: bytes.length / width }, (_, index) =>
      width === 2 ? view.getUint16(index * width) : view.getUint32(index * width),
    )
  }
  const isPlausible = (values: number[]) =>
    values.length > 0 &&
    values.every((value, index) => value >= 0 && value <= duration + 30 && (index === 0 || value >= values[index - 1]))

  const removeHeader = (values: number[]) =>
    values.length > 1 && values[0] === 0 && values[1] === 0 ? values.slice(1) : values

  const uint16Values = removeHeader(parse(2))
  if (isPlausible(uint16Values)) {
    return uint16Values
  }
  const uint32Values = removeHeader(parse(4))
  return isPlausible(uint32Values) ? uint32Values : []
}

const fetchFrameManifest = async (
  videoId: string,
  cid: number,
  duration: number,
): Promise<CourseFrameManifest | null> => {
  try {
    const data = await fetchJson(
      `https://api.bilibili.com/x/player/videoshot?bvid=${encodeURIComponent(videoId)}&cid=${cid}`,
      '关键帧',
    )
    if (!Array.isArray(data.image) || data.image.length < 1) {
      return null
    }

    const originalImages = data.image.map(toHttpsUrl)
    const images = originalImages.map((_, sheetIndex) => {
      const query = new URLSearchParams({ videoId, cid: String(cid), sheet: String(sheetIndex) })
      return `/api/course/bilibili-frame?${query.toString()}`
    })
    const columns = toPositiveInteger(data.img_x_len)
    const rows = toPositiveInteger(data.img_y_len)
    const frameWidth = toPositiveInteger(data.img_x_size)
    const frameHeight = toPositiveInteger(data.img_y_size)
    if (!columns || !rows || !frameWidth || !frameHeight || typeof data.pvdata !== 'string') {
      return null
    }

    const timestampResponse = await fetch(toHttpsUrl(data.pvdata), { signal: AbortSignal.timeout(12000) })
    if (!timestampResponse.ok) {
      return null
    }
    const timestamps = parsePreviewTimestamps(await timestampResponse.arrayBuffer(), duration)
    if (timestamps.length < 1) {
      return null
    }

    return {
      type: 'bilibili-sprite',
      images,
      timestamps,
      columns,
      rows,
      frameWidth,
      frameHeight,
    }
  } catch {
    return null
  }
}

export const resolveBilibiliFrameSheet = async (videoId: string, cid: number, sheetIndex: number) => {
  const data = await fetchJson(
    `https://api.bilibili.com/x/player/videoshot?bvid=${encodeURIComponent(videoId)}&cid=${cid}`,
    '关键帧',
  )
  if (!Array.isArray(data.image) || sheetIndex < 0 || sheetIndex >= data.image.length) {
    throw new Error('Bilibili 关键帧序号无效')
  }
  return toHttpsUrl(data.image[sheetIndex])
}

const fetchCaptionSegments = async (playerData: JsonObject): Promise<TranscriptSegment[]> => {
  const subtitleContainer = isJsonObject(playerData.subtitle) ? playerData.subtitle : null
  const subtitleItems =
    subtitleContainer && Array.isArray(subtitleContainer.subtitles) ? subtitleContainer.subtitles : []
  const candidates = subtitleItems.filter(
    (item): item is JsonObject => isJsonObject(item) && typeof item.subtitle_url === 'string',
  )
  if (candidates.length < 1) {
    return []
  }

  const selected =
    candidates.find((item) => item.lan === 'zh-CN' || item.lan === 'zh-Hans' || item.lan === 'ai-zh') || candidates[0]
  const response = await fetch(toHttpsUrl(selected.subtitle_url), {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) {
    throw new Error(`Bilibili 字幕下载失败（HTTP ${response.status}）`)
  }

  const json: unknown = await response.json()
  if (!isJsonObject(json) || !Array.isArray(json.body)) {
    throw new Error('Bilibili 字幕正文格式异常')
  }

  return json.body
    .map((item, index): TranscriptSegment | null => {
      if (!isJsonObject(item) || typeof item.content !== 'string') {
        return null
      }
      const start = toFiniteNumber(item.from)
      const end = toFiniteNumber(item.to)
      const text = item.content.trim()
      if (start === null || !text) {
        return null
      }
      return {
        id: `caption-${index}`,
        start,
        end: end !== null && end >= start ? end : start,
        text,
        source: 'caption',
      }
    })
    .filter((item): item is TranscriptSegment => item !== null)
}

type ResolvedBilibiliAudio = {
  id: number
  url: string
  mimeType: string
  codec: string
  bandwidth: number
  size: number | null
}

const AUDIO_CACHE_TTL_MS = 60 * 1000
const resolvedAudioCache = new Map<string, { expiresAt: number; value: ResolvedBilibiliAudio }>()

const getCachedAudio = (videoId: string, cid: number, audioId: number) => {
  const key = `${videoId}:${cid}:${audioId}`
  const cached = resolvedAudioCache.get(key)
  if (!cached || cached.expiresAt <= Date.now()) {
    resolvedAudioCache.delete(key)
    return null
  }
  return cached.value
}

const probeAudioSize = async (url: string, videoId: string) => {
  const headers = {
    Referer: `https://www.bilibili.com/video/${encodeURIComponent(videoId)}`,
    'User-Agent': createHeaders()['User-Agent'],
  }
  try {
    const response = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(10000) })
    const contentLength = Number(response.headers.get('content-length'))
    if (response.ok && Number.isSafeInteger(contentLength) && contentLength > 0) {
      return contentLength
    }
  } catch {
    // Some Bilibili CDNs do not implement HEAD consistently; a one-byte range is the fallback.
  }

  try {
    const response = await fetch(url, {
      headers: { ...headers, Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(10000),
    })
    const match = response.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/)
    const size = match ? Number(match[1]) : Number.NaN
    return response.status === 206 && Number.isSafeInteger(size) && size > 0 ? size : null
  } catch {
    return null
  }
}

export const resolveBilibiliAudioStream = async (
  videoId: string,
  cid: number,
  preferredAudioId?: number,
): Promise<ResolvedBilibiliAudio> => {
  if (preferredAudioId) {
    const cached = getCachedAudio(videoId, cid, preferredAudioId)
    if (cached) {
      return cached
    }
  }

  const data = await fetchJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(videoId)}&cid=${cid}&fnval=4048&qn=80`,
    '音频流',
  )
  const dash = isJsonObject(data.dash) ? data.dash : null
  const audioItems = dash && Array.isArray(dash.audio) ? dash.audio.filter(isJsonObject) : []
  const candidates = audioItems
    .map((item) => ({
      id: toPositiveInteger(item.id),
      url: typeof item.baseUrl === 'string' ? item.baseUrl : typeof item.base_url === 'string' ? item.base_url : '',
      mimeType: typeof item.mimeType === 'string' ? item.mimeType : 'audio/mp4',
      codec: typeof item.codecs === 'string' ? item.codecs : 'mp4a.40.2',
      bandwidth: toPositiveInteger(item.bandwidth) || Number.MAX_SAFE_INTEGER,
    }))
    .filter((item): item is typeof item & { id: number } => Boolean(item.url && item.id))
    .sort((a, b) => a.bandwidth - b.bandwidth)
  if (candidates.length < 1) {
    throw new Error('Bilibili 没有返回可用音频流')
  }

  const selected = preferredAudioId ? candidates.find((candidate) => candidate.id === preferredAudioId) : candidates[0]
  if (!selected) {
    throw new Error('Bilibili 原音频流已失效，请重新检查视频来源')
  }
  const url = toHttpsUrl(selected.url)
  const resolved = {
    id: selected.id,
    url,
    mimeType: selected.mimeType,
    codec: selected.codec,
    bandwidth: selected.bandwidth,
    size: await probeAudioSize(url, videoId),
  }
  resolvedAudioCache.set(`${videoId}:${cid}:${selected.id}`, {
    expiresAt: Date.now() + AUDIO_CACHE_TTL_MS,
    value: resolved,
  })
  return resolved
}

const fetchAudioSource = async (videoId: string, cid: number, duration: number): Promise<CourseAudioSource> => {
  const resolved = await resolveBilibiliAudioStream(videoId, cid)
  const query = new URLSearchParams({
    videoId,
    cid: String(cid),
    audioId: String(resolved.id),
  })
  return {
    url: `/api/course/bilibili-audio?${query.toString()}`,
    mimeType: resolved.mimeType,
    codec: resolved.codec,
    bandwidth: resolved.bandwidth,
    duration,
    size: resolved.size || Math.ceil((resolved.bandwidth * duration) / 8),
  }
}

export async function fetchBilibiliCourseSource(videoId: string, pageNumber: number): Promise<CourseSource> {
  const normalizedVideoId = videoId.trim()
  const viewData = await fetchJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(normalizedVideoId)}`,
    '视频信息',
  )
  const title = typeof viewData.title === 'string' ? viewData.title.trim() : ''
  const aid = toPositiveInteger(viewData.aid)
  if (!title || !aid || !Array.isArray(viewData.pages)) {
    throw new Error('Bilibili 视频信息不完整')
  }

  const page = viewData.pages.find((item) => isJsonObject(item) && toPositiveInteger(item.page) === pageNumber)
  if (!isJsonObject(page)) {
    throw new Error(`Bilibili 视频不存在第 ${pageNumber} 分P`)
  }
  const cid = toPositiveInteger(page.cid)
  const duration = toPositiveInteger(page.duration) || toPositiveInteger(viewData.duration)
  if (!cid || !duration) {
    throw new Error('Bilibili 视频缺少有效时长或 cid')
  }

  const [playerData, frames] = await Promise.all([
    fetchJson(`https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`, '播放器信息'),
    fetchFrameManifest(normalizedVideoId, cid, duration),
  ])
  const transcript = await fetchCaptionSegments(playerData)
  const audio = transcript.length > 0 ? null : await fetchAudioSource(normalizedVideoId, cid, duration)

  return {
    service: VideoService.Bilibili,
    videoId: normalizedVideoId,
    pageNumber,
    title,
    duration,
    mode: transcript.length > 0 ? 'captions' : 'local-asr',
    transcript,
    audio,
    frames,
  }
}
