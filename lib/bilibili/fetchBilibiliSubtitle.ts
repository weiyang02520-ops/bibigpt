import { type BilibiliSubtitleItem, reduceBilibiliSubtitleTimestamp } from '~/utils/reduceSubtitleTimestamp'
import { fetchBilibiliSubtitleUrls } from './fetchBilibiliSubtitleUrls'

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getSubtitleUrl = (subtitleUrl: string): string => {
  const absoluteUrl = subtitleUrl.startsWith('//') ? `https:${subtitleUrl}` : subtitleUrl

  try {
    const parsedUrl = new URL(absoluteUrl)
    if (parsedUrl.protocol !== 'https:') {
      throw new Error()
    }
    return parsedUrl.toString()
  } catch {
    throw new Error('Bilibili 返回的字幕地址无效')
  }
}

const fetchSubtitleBody = async (subtitleUrl: string): Promise<BilibiliSubtitleItem[]> => {
  let response: Response
  try {
    response = await fetch(subtitleUrl, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
      },
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(10000),
    })
  } catch {
    throw new Error('无法下载 Bilibili 字幕，请稍后重试')
  }

  if (!response.ok) {
    throw new Error(`Bilibili 字幕下载失败（HTTP ${response.status}）`)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new Error('Bilibili 字幕响应不是有效的 JSON')
  }

  if (!isJsonObject(json) || !Array.isArray(json.body)) {
    throw new Error('Bilibili 字幕正文格式异常')
  }

  return json.body.map((item) => {
    if (
      !isJsonObject(item) ||
      typeof item.from !== 'number' ||
      !Number.isFinite(item.from) ||
      typeof item.content !== 'string'
    ) {
      throw new Error('Bilibili 字幕正文包含无效条目')
    }

    return { from: item.from, content: item.content }
  })
}

export async function fetchBilibiliSubtitle(
  videoId: string,
  pageNumber?: null | string,
  shouldShowTimestamp?: boolean,
) {
  const { title, subtitle } = await fetchBilibiliSubtitleUrls(videoId, pageNumber)
  const subtitleList = subtitle.list
  if (subtitleList.length < 1) {
    return { title, subtitlesArray: null }
  }

  const betterSubtitle = subtitleList.find(({ lan }) => lan === 'zh-CN') || subtitleList[0]
  const subtitleUrl = getSubtitleUrl(betterSubtitle.subtitle_url)
  const subtitleBody = (await fetchSubtitleBody(subtitleUrl)).filter(({ content }) => content.trim())
  const transcripts = reduceBilibiliSubtitleTimestamp(subtitleBody, shouldShowTimestamp).filter(({ text }) =>
    text.trim(),
  )
  if (transcripts.length < 1) {
    return { title, subtitlesArray: null }
  }

  return { title, subtitlesArray: transcripts }
}
