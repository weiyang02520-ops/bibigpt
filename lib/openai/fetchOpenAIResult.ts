import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { ModelMessage, generateText, streamText } from 'ai'
import { Redis } from '@upstash/redis'
import { trimOpenAiResult } from '~/lib/openai/trimOpenAiResult'
import { VideoConfig } from '~/lib/types'
import { getCacheId } from '~/utils/getCacheId'

const cacheRedisUrl = process.env.UPSTASH_REDIS_REST_URL
const cacheRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN
const cacheRedis = cacheRedisUrl && cacheRedisToken ? new Redis({ url: cacheRedisUrl, token: cacheRedisToken }) : null

export enum ChatGPTAgent {
  user = 'user',
  system = 'system',
  assistant = 'assistant',
}

export interface ChatGPTMessage {
  role: ChatGPTAgent
  content: string
}
export interface OpenAIStreamPayload {
  api_key?: string
  model: string
  messages: ChatGPTMessage[]
  temperature?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
  max_tokens: number
  stream: boolean
  n?: number
}

function createProvider(apiKey: string, baseUrl: string) {
  return createOpenAICompatible({
    baseURL: baseUrl,
    name: process.env.OPENAI_COMPATIBLE_PROVIDER_NAME || 'openai-compatible',
    apiKey,
  })
}

function toModelMessages(messages: ChatGPTMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  })) as ModelMessage[]
}

async function cacheResult(cacheId: string, value: string) {
  if (!cacheRedis) {
    return
  }

  try {
    const data = await cacheRedis.set(cacheId, value)
    console.info(`video ${cacheId} cached:`, data)
  } catch (error) {
    console.warn(`video ${cacheId} cache write failed`, error)
  }
}

async function generateTextFallback(params: {
  model: ReturnType<ReturnType<typeof createProvider>['chatModel']>
  messages: ModelMessage[]
  payload: OpenAIStreamPayload
}) {
  const result = await generateText({
    model: params.model,
    messages: params.messages,
    maxOutputTokens: params.payload.max_tokens,
    temperature: params.payload.temperature,
    topP: params.payload.top_p,
    frequencyPenalty: params.payload.frequency_penalty,
    presencePenalty: params.payload.presence_penalty,
  })

  return trimOpenAiResult(result.text)
}

export async function fetchOpenAIResult(
  payload: OpenAIStreamPayload,
  apiKey: string,
  videoConfig: VideoConfig,
  baseUrl: string,
) {
  const resolvedApiKey = apiKey.trim()
  if (!resolvedApiKey) {
    throw new Error('Missing API key for OpenAI-compatible provider')
  }
  const model = createProvider(resolvedApiKey, baseUrl).chatModel(payload.model)
  const messages = toModelMessages(payload.messages)

  const cacheId = getCacheId(videoConfig, baseUrl)

  if (!payload.stream) {
    const betterResult = await generateTextFallback({ model, messages, payload })

    await cacheResult(cacheId, betterResult)
    return betterResult
  }

  const result = streamText({
    model,
    messages,
    maxOutputTokens: payload.max_tokens,
    temperature: payload.temperature,
    topP: payload.top_p,
    frequencyPenalty: payload.frequency_penalty,
    presencePenalty: payload.presence_penalty,
  })

  const encoder = new TextEncoder()
  let tempData = ''
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const textPart of result.textStream) {
          tempData += textPart
          controller.enqueue(encoder.encode(textPart))
        }

        // Edge runtime can fail to decode provider stream in some environments.
        // If stream finished but emitted no usable content, fallback to non-stream.
        if (!tempData.trim()) {
          const fallbackText = await generateTextFallback({ model, messages, payload })
          if (fallbackText) {
            tempData = fallbackText
            controller.enqueue(encoder.encode(fallbackText))
          }
        }

        controller.close()
        await cacheResult(cacheId, tempData)
      } catch (streamError) {
        if (tempData.trim()) {
          controller.enqueue(encoder.encode('\n\n> 模型响应在流式输出中断，请重试。'))
          controller.close()
          return
        }

        // No partial output reached the browser, so one non-stream fallback is safe.
        try {
          const fallbackText = await generateTextFallback({ model, messages, payload })
          tempData = fallbackText
          controller.enqueue(encoder.encode(fallbackText))
          controller.close()
          await cacheResult(cacheId, tempData)
        } catch (fallbackError) {
          controller.error(fallbackError)
        }
      }
    },
  })

  return stream
}
