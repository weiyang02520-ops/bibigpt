import { ApiRequestError } from '~/lib/apiRequestError'
import { sample } from '~/utils/fp'

export async function selectOpenAICompatibleApiKey(apiKey?: string) {
  const configuredKeys = apiKey?.trim() || process.env.OPENAI_COMPATIBLE_API_KEY || process.env.OPENAI_API_KEY || ''
  const apiKeys = configuredKeys
    .split(',')
    .map((key) => key.trim())
    .filter(Boolean)
  const selectedApiKey = sample(apiKeys)

  if (!selectedApiKey) {
    throw new ApiRequestError(400, '请先填写 API Key，或在部署环境中配置 OPENAI_COMPATIBLE_API_KEY。')
  }

  return selectedApiKey
}
