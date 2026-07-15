import type { NextApiRequest, NextApiResponse } from 'next'
import { getApiRequestStatus } from '~/lib/apiRequestError'
import { buildSummarizeOpenAIPayload } from '~/lib/openai/buildSummarizeRequest'
import { fetchOpenAIResult } from '~/lib/openai/fetchOpenAIResult'
import { selectOpenAICompatibleApiKey } from '~/lib/openai/selectOpenAICompatibleApiKey'
import { validateOpenAIBaseUrl } from '~/lib/openai/validateOpenAIBaseUrl'
import { SummarizeParams } from '~/lib/types'
import { prepareTextStreamResponse, writeWebStreamToNodeResponse } from '~/lib/openai/writeWebStreamToNodeResponse'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ errorMessage: 'Method Not Allowed' })
  }

  const summarizeParams = req.body as Partial<SummarizeParams>
  if (!summarizeParams?.videoConfig || !summarizeParams?.userConfig) {
    return res.status(400).json({ errorMessage: 'Missing videoConfig or userConfig' })
  }

  try {
    const normalizedParams = summarizeParams as SummarizeParams
    const { videoConfig, userConfig } = normalizedParams
    const openaiApiKey = await selectOpenAICompatibleApiKey(userConfig.userKey)
    const baseUrl = await validateOpenAIBaseUrl(userConfig.baseUrl)
    const { openAiPayload } = await buildSummarizeOpenAIPayload(normalizedParams)
    const result = await fetchOpenAIResult(openAiPayload, openaiApiKey, videoConfig, baseUrl)

    if (openAiPayload.stream) {
      prepareTextStreamResponse(res)
      if (result instanceof ReadableStream) {
        await writeWebStreamToNodeResponse(result, res)
        return
      }
      res.status(200).send(result)
      return
    }

    res.status(200).json(result)
  } catch (error: any) {
    const statusCode = getApiRequestStatus(error)
    console.error(error?.message)
    return res.status(statusCode).json({
      errorMessage: error?.message || 'Internal Server Error',
    })
  }
}
