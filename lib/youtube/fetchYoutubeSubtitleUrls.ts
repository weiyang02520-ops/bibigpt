import {
  fetchTranscript,
  type TranscriptResponse,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptNotAvailableLanguageError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
} from 'youtube-transcript'

export type YoutubeTranscriptItem = TranscriptResponse

type JsonObject = Record<string, unknown>

class YoutubeResourceHttpError extends Error {
  status: number

  constructor(status: number) {
    super('YouTube resource request failed')
    this.status = status
  }
}

class YoutubeResourceNetworkError extends Error {}
class YoutubeTranscriptResponseError extends Error {}

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fetchYoutubeResource: typeof fetch = async (input, init) => {
  let response: Response
  try {
    response = await fetch(input, { ...init, signal: init?.signal || AbortSignal.timeout(10000) })
  } catch {
    throw new YoutubeResourceNetworkError()
  }

  if (!response.ok) {
    throw new YoutubeResourceHttpError(response.status)
  }

  return response
}

const fetchYoutubeTitle = async (videoId: string): Promise<string> => {
  const watchUrl = new URL('https://www.youtube.com/watch')
  watchUrl.searchParams.set('v', videoId)
  const oEmbedUrl = new URL('https://www.youtube.com/oembed')
  oEmbedUrl.searchParams.set('url', watchUrl.toString())
  oEmbedUrl.searchParams.set('format', 'json')

  try {
    const response = await fetch(oEmbedUrl, {
      headers: { Accept: 'application/json' },
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) {
      return videoId
    }

    const json: unknown = await response.json()
    if (isJsonObject(json) && typeof json.title === 'string' && json.title.trim()) {
      return json.title.trim()
    }
  } catch {
    // Title metadata is optional; transcript failures are handled separately.
  }

  return videoId
}

const validateTranscript = (value: unknown): YoutubeTranscriptItem[] => {
  if (!Array.isArray(value)) {
    throw new YoutubeTranscriptResponseError()
  }

  return value
    .map((item) => {
      if (
        !isJsonObject(item) ||
        typeof item.text !== 'string' ||
        typeof item.duration !== 'number' ||
        !Number.isFinite(item.duration) ||
        item.duration < 0 ||
        typeof item.offset !== 'number' ||
        !Number.isFinite(item.offset) ||
        item.offset < 0 ||
        (item.lang !== undefined && typeof item.lang !== 'string')
      ) {
        throw new YoutubeTranscriptResponseError()
      }

      return {
        text: item.text.trim(),
        duration: item.duration,
        offset: item.offset,
        ...(typeof item.lang === 'string' ? { lang: item.lang } : {}),
      }
    })
    .filter(({ text }) => text.length > 0)
}

const fetchYoutubeTranscript = async (videoId: string): Promise<YoutubeTranscriptItem[]> => {
  try {
    const transcript: unknown = await fetchTranscript(videoId, { fetch: fetchYoutubeResource })
    return validateTranscript(transcript)
  } catch (error) {
    if (
      error instanceof YoutubeTranscriptDisabledError ||
      error instanceof YoutubeTranscriptNotAvailableLanguageError
    ) {
      return []
    }

    if (error instanceof YoutubeTranscriptTooManyRequestError) {
      throw new Error('YouTube 字幕请求过于频繁，请稍后重试')
    }

    if (error instanceof YoutubeResourceHttpError) {
      if (error.status === 429) {
        throw new Error('YouTube 字幕请求过于频繁，请稍后重试')
      }
      throw new Error(`YouTube 字幕上游请求失败（HTTP ${error.status}）`)
    }

    if (error instanceof YoutubeResourceNetworkError) {
      throw new Error('无法连接 YouTube 字幕服务，请检查网络或代理后重试')
    }

    if (error instanceof TypeError) {
      throw new Error('无法连接 YouTube 字幕服务，请检查网络或代理后重试')
    }

    if (error instanceof YoutubeTranscriptVideoUnavailableError) {
      throw new Error('YouTube 视频不可用或不存在')
    }

    if (error instanceof YoutubeTranscriptNotAvailableError) {
      throw new Error('YouTube 已发现字幕轨，但字幕内容获取失败，请稍后重试')
    }

    if (error instanceof YoutubeTranscriptResponseError) {
      throw new Error('YouTube 字幕上游响应格式异常')
    }

    if (error instanceof YoutubeTranscriptError) {
      throw new Error('YouTube 字幕上游处理失败，请稍后重试')
    }

    throw new Error('YouTube 字幕抓取失败，请稍后重试')
  }
}

export async function fetchYoutubeSubtitleUrls(videoId: string): Promise<{
  title: string
  subtitleList: YoutubeTranscriptItem[]
}> {
  const normalizedVideoId = videoId.trim()
  if (!normalizedVideoId) {
    throw new Error('YouTube 视频 ID 不能为空')
  }

  const [title, subtitleList] = await Promise.all([
    fetchYoutubeTitle(normalizedVideoId),
    fetchYoutubeTranscript(normalizedVideoId),
  ])
  return { title, subtitleList }
}
