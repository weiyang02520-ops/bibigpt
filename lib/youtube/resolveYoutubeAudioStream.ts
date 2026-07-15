type YoutubeFormat = {
  itag: number
  url?: string
  mime_type: string
  content_length?: number
  bitrate: number
  average_bitrate?: number
  approx_duration_ms: number
  last_modified_ms?: string
  has_audio: boolean
  has_video: boolean
  decipher: (player?: unknown) => Promise<string>
}

export type ResolvedYoutubeAudio = {
  videoId: string
  title: string
  duration: number
  itag: number
  url: string
  mimeType: string
  codec: string
  bitrate: number
  size: number
  revision: string
}

const YOUTUBE_VIDEO_ID_PATTERN = /^[0-9A-Za-z_-]{11}$/
const AUDIO_CACHE_TTL_MS = 60 * 1000

const resolvedAudioCache = new Map<string, { expiresAt: number; value: ResolvedYoutubeAudio }>()

const getCachedAudio = (videoId: string, itag?: number) => {
  const prefix = itag ? `${videoId}:${itag}:` : `${videoId}:`
  const now = Date.now()
  for (const [key, cached] of Array.from(resolvedAudioCache.entries())) {
    if (cached.expiresAt <= now) {
      resolvedAudioCache.delete(key)
      continue
    }
    if (key.startsWith(prefix)) {
      return cached.value
    }
  }
  return null
}

const getCodec = (mimeType: string) => {
  const match = mimeType.match(/codecs="([^"]+)"/)
  return match?.[1] || 'mp4a.40.2'
}

const toPositiveInteger = (value: unknown) => {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

const probeAudioSize = async (url: string) => {
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { 'User-Agent': createYoutubeUserAgent() },
      signal: AbortSignal.timeout(12000),
    })
    const size = toPositiveInteger(response.headers.get('content-length'))
    if (response.ok && size) {
      return size
    }
  } catch {
    // GoogleVideo edge nodes are not consistent about HEAD; a one-byte range is the fallback.
  }

  const response = await fetch(url, {
    headers: { Range: 'bytes=0-0', 'User-Agent': createYoutubeUserAgent() },
    signal: AbortSignal.timeout(12000),
  })
  const match = response.headers.get('content-range')?.match(/^bytes 0-0\/(\d+)$/)
  const size = match ? toPositiveInteger(match[1]) : null
  if (response.status === 206 && size) {
    return size
  }
  throw new Error('无法读取 YouTube 音频大小')
}

export const createYoutubeUserAgent = () =>
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

const timeoutFetch: typeof fetch = async (input, init) =>
  fetch(input, {
    ...init,
    headers: {
      'User-Agent': createYoutubeUserAgent(),
      ...(init?.headers || {}),
    },
    signal: init?.signal || AbortSignal.timeout(15000),
  })

const installYoutubeEvaluator = async () => {
  const vm = await import('node:vm')
  const { Platform } = await import('youtubei.js')
  const currentShim = Platform.shim
  Platform.load({
    ...currentShim,
    eval: async (data: { output: string }, env: Record<string, unknown>) => {
      const context = vm.createContext(
        { env, process: undefined, global: undefined, globalThis: undefined },
        { codeGeneration: { strings: false, wasm: false } },
      )
      const script = new vm.Script(data.output)
      return script.runInContext(context, { timeout: 1000 })
    },
  })
}

const loadInnertube = async () => {
  await installYoutubeEvaluator()
  const { Innertube } = await import('youtubei.js')
  return Innertube.create({
    lang: 'zh-CN',
    location: 'US',
    retrieve_player: true,
    generate_session_locally: true,
    enable_session_cache: false,
    fetch: timeoutFetch,
  })
}

const normalizeFormats = (formats: unknown): YoutubeFormat[] =>
  Array.isArray(formats)
    ? formats.filter((format): format is YoutubeFormat => {
        const candidate = format as Partial<YoutubeFormat>
        return (
          typeof candidate.itag === 'number' &&
          typeof candidate.mime_type === 'string' &&
          typeof candidate.decipher === 'function' &&
          candidate.has_audio === true &&
          candidate.has_video === false
        )
      })
    : []

const selectAudioFormat = (formats: YoutubeFormat[], preferredItag?: number) => {
  const audioFormats = formats.filter((format) => format.mime_type.includes('audio/mp4'))
  const mp4aFormats = audioFormats.filter((format) => getCodec(format.mime_type).includes('mp4a'))
  const candidates = mp4aFormats.length > 0 ? mp4aFormats : audioFormats
  if (candidates.length < 1) {
    throw new Error('YouTube 没有返回可用于浏览器本地转写的 MP4 音频流')
  }

  const selected = preferredItag
    ? candidates.find((format) => format.itag === preferredItag)
    : [...candidates].sort((left, right) => {
        const leftBitrate = left.average_bitrate || left.bitrate || Number.MAX_SAFE_INTEGER
        const rightBitrate = right.average_bitrate || right.bitrate || Number.MAX_SAFE_INTEGER
        return leftBitrate - rightBitrate || left.itag - right.itag
      })[0]
  if (!selected) {
    throw new Error('YouTube 原音频流已失效，请重新检查视频来源')
  }
  return selected
}

export async function resolveYoutubeAudioStream(
  videoId: string,
  preferredItag?: number,
): Promise<ResolvedYoutubeAudio> {
  const normalizedVideoId = videoId.trim()
  if (!YOUTUBE_VIDEO_ID_PATTERN.test(normalizedVideoId)) {
    throw new Error('YouTube 视频 ID 无效')
  }

  const cached = getCachedAudio(normalizedVideoId, preferredItag)
  if (cached) {
    return cached
  }

  const youtube = await loadInnertube()
  const info = await youtube.getBasicInfo(normalizedVideoId)
  const formats = normalizeFormats(info.streaming_data?.adaptive_formats)
  const selected = selectAudioFormat(formats, preferredItag)
  const url = await selected.decipher(youtube.session.player)
  const duration =
    toPositiveInteger(info.basic_info.duration) || Math.max(1, Math.round(selected.approx_duration_ms / 1000))
  const size = toPositiveInteger(selected.content_length) || (await probeAudioSize(url))
  const revision = [
    selected.itag,
    selected.last_modified_ms || '0',
    selected.approx_duration_ms || duration * 1000,
  ].join('-')

  const resolved = {
    videoId: normalizedVideoId,
    title: info.basic_info.title?.trim() || normalizedVideoId,
    duration,
    itag: selected.itag,
    url,
    mimeType: selected.mime_type.split(';')[0] || 'audio/mp4',
    codec: getCodec(selected.mime_type),
    bitrate: selected.average_bitrate || selected.bitrate || Math.ceil((size * 8) / duration),
    size,
    revision,
  }
  resolvedAudioCache.set(`${normalizedVideoId}:${selected.itag}:${revision}`, {
    expiresAt: Date.now() + AUDIO_CACHE_TTL_MS,
    value: resolved,
  })
  return resolved
}
