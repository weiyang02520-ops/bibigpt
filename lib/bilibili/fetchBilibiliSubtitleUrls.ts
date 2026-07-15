import { sample } from '~/utils/fp'

type BilibiliSubtitle = {
  lan: string
  subtitle_url: string
}

interface BilibiliVideoInfo {
  title: string
  subtitle: {
    list: BilibiliSubtitle[]
  }
}

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toPositiveInteger = (value: unknown): number | null => {
  const numberValue =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN

  return Number.isSafeInteger(numberValue) && numberValue > 0 ? numberValue : null
}

const fetchBilibiliJson = async (url: string, config: RequestInit, requestName: string): Promise<JsonObject> => {
  let response: Response
  try {
    response = await fetch(url, { ...config, signal: AbortSignal.timeout(10000) })
  } catch {
    throw new Error(`无法连接 Bilibili，${requestName}请求失败，请稍后重试`)
  }

  if (!response.ok) {
    throw new Error(`Bilibili ${requestName}请求失败（HTTP ${response.status}）`)
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    throw new Error(`Bilibili ${requestName}响应不是有效的 JSON`)
  }

  if (!isJsonObject(json)) {
    throw new Error(`Bilibili ${requestName}响应格式异常`)
  }

  return json
}

const getBilibiliResponseData = (json: JsonObject, requestName: string): JsonObject => {
  if (typeof json.code !== 'number') {
    throw new Error(`Bilibili ${requestName}响应缺少有效的业务码`)
  }

  if (json.code !== 0) {
    throw new Error(`Bilibili ${requestName}请求失败（业务码 ${json.code}）`)
  }

  if (!isJsonObject(json.data)) {
    throw new Error(`Bilibili ${requestName}响应缺少有效数据`)
  }

  return json.data
}

const parsePageNumber = (pageNumber?: null | string): number => {
  const parsedPageNumber = Number(pageNumber || 1)
  if (!Number.isSafeInteger(parsedPageNumber) || parsedPageNumber < 1) {
    throw new Error('Bilibili 分P页码无效')
  }

  return parsedPageNumber
}

const parseSubtitleList = (value: unknown): BilibiliSubtitle[] => {
  if (!Array.isArray(value)) {
    throw new Error('Bilibili 播放器响应中的字幕列表格式异常')
  }

  return value.map((item) => {
    if (
      !isJsonObject(item) ||
      typeof item.lan !== 'string' ||
      typeof item.subtitle_url !== 'string' ||
      !item.subtitle_url.trim()
    ) {
      throw new Error('Bilibili 播放器返回了无效的字幕条目')
    }

    return {
      lan: item.lan,
      subtitle_url: item.subtitle_url,
    }
  })
}

export const fetchBilibiliSubtitleUrls = async (
  videoId: string,
  pageNumber?: null | string,
): Promise<BilibiliVideoInfo> => {
  const sessionTokens = (process.env.BILIBILI_SESSION_TOKEN || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
  const sessdata = sample(sessionTokens) as string | undefined
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
  }
  if (sessdata) {
    headers.Cookie = `SESSDATA=${sessdata}`
  }

  const commonConfig: RequestInit = {
    method: 'GET',
    cache: 'no-cache',
    headers,
    referrerPolicy: 'no-referrer',
  }

  const normalizedVideoId = videoId.trim()
  if (!normalizedVideoId) {
    throw new Error('Bilibili 视频 ID 不能为空')
  }

  const params = normalizedVideoId.startsWith('av')
    ? `aid=${encodeURIComponent(normalizedVideoId.slice(2))}`
    : `bvid=${encodeURIComponent(normalizedVideoId)}`
  const viewJson = await fetchBilibiliJson(
    `https://api.bilibili.com/x/web-interface/view?${params}`,
    commonConfig,
    '视频信息',
  )
  const viewData = getBilibiliResponseData(viewJson, '视频信息')

  if (typeof viewData.title !== 'string' || !viewData.title.trim()) {
    throw new Error('Bilibili 视频信息响应缺少有效标题')
  }

  const aid = toPositiveInteger(viewData.aid)
  if (aid === null) {
    throw new Error('Bilibili 视频信息响应缺少有效的 aid')
  }

  if (!Array.isArray(viewData.pages) || viewData.pages.length < 1) {
    throw new Error('Bilibili 视频信息响应缺少有效的分P列表')
  }

  const requestedPageNumber = parsePageNumber(pageNumber)
  const selectedPage = viewData.pages.find(
    (page) => isJsonObject(page) && toPositiveInteger(page.page) === requestedPageNumber,
  )
  if (!isJsonObject(selectedPage)) {
    throw new Error(`Bilibili 视频不存在第 ${requestedPageNumber} 分P`)
  }

  const cid = toPositiveInteger(selectedPage.cid)
  if (cid === null) {
    throw new Error(`Bilibili 第 ${requestedPageNumber} 分P缺少有效的 cid`)
  }

  const playerJson = await fetchBilibiliJson(
    `https://api.bilibili.com/x/player/v2?aid=${aid}&cid=${cid}`,
    commonConfig,
    '播放器信息',
  )
  const playerData = getBilibiliResponseData(playerJson, '播放器信息')
  const subtitleList = isJsonObject(playerData.subtitle) ? parseSubtitleList(playerData.subtitle.subtitles ?? []) : []
  return {
    ...viewData,
    title: viewData.title,
    subtitle: { list: subtitleList },
  }
}
