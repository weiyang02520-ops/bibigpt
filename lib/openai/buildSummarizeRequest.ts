import { fetchSubtitle } from '~/lib/fetchSubtitle'
import { ApiRequestError } from '~/lib/apiRequestError'
import { ChatGPTAgent, OpenAIStreamPayload } from '~/lib/openai/fetchOpenAIResult'
import { getSmallSizeTranscripts } from '~/lib/openai/getSmallSizeTranscripts'
import { getUserSubtitlePrompt, getUserSubtitleWithTimestampPrompt } from '~/lib/openai/prompt'
import { SummarizeParams } from '~/lib/types'

const DEFAULT_MODEL = process.env.OPENAI_COMPATIBLE_MODEL?.trim()

export class SummarizeRequestError extends ApiRequestError {}

export async function buildSummarizeOpenAIPayload({ videoConfig, userConfig }: SummarizeParams): Promise<{
  openAiPayload: OpenAIStreamPayload
  videoId: string
}> {
  const { shouldShowTimestamp } = userConfig || {}
  const { videoId } = videoConfig

  if (!videoId) {
    throw new SummarizeRequestError(400, '请求中缺少视频 ID。')
  }

  const model = videoConfig.model?.trim() || DEFAULT_MODEL
  if (!model) {
    throw new SummarizeRequestError(400, '请填写 OpenAI-compatible 模型 ID。')
  }

  let subtitleResult: Awaited<ReturnType<typeof fetchSubtitle>>
  try {
    subtitleResult = await fetchSubtitle(videoConfig, shouldShowTimestamp)
  } catch (error: any) {
    const detail = error?.message || '未知错误'
    throw new SummarizeRequestError(502, `字幕获取失败：${detail}`)
  }

  const { title, subtitlesArray } = subtitleResult
  const transcriptItems = (subtitlesArray || []).filter((item) => item && String(item.text || '').trim())
  if (!transcriptItems.length) {
    console.error('No usable subtitle in the video: ', videoId)
    throw new SummarizeRequestError(422, '这个视频没有可用字幕，未调用模型，也不会用视频简介代替。')
  }

  const inputText = getSmallSizeTranscripts(transcriptItems, transcriptItems)

  const userPrompt = shouldShowTimestamp
    ? getUserSubtitleWithTimestampPrompt(title || videoId, inputText, videoConfig)
    : getUserSubtitlePrompt(title || videoId, inputText, videoConfig)

  const openAiPayload: OpenAIStreamPayload = {
    model,
    messages: [{ role: ChatGPTAgent.user, content: userPrompt }],
    max_tokens: Number(videoConfig.detailLevel) || 600,
    stream: Boolean(videoConfig.enableStream ?? true),
  }

  return { openAiPayload, videoId }
}
