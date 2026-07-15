import type { NextApiRequest, NextApiResponse } from 'next'
import { getApiRequestStatus } from '~/lib/apiRequestError'
import { buildSummarizeOpenAIPayload } from '~/lib/openai/buildSummarizeRequest'
import { fetchOpenAIResult } from '~/lib/openai/fetchOpenAIResult'
import { selectOpenAICompatibleApiKey } from '~/lib/openai/selectOpenAICompatibleApiKey'
import { validateOpenAIBaseUrl } from '~/lib/openai/validateOpenAIBaseUrl'
import { SummarizeParams } from '~/lib/types'
import { prepareTextStreamResponse, writeWebStreamToNodeResponse } from '~/lib/openai/writeWebStreamToNodeResponse'

type ChatBody = Partial<SummarizeParams> & {
  messages?: Array<{ role: string; content?: string }>
}

function toHttpErrorMessage(statusCode: number, message: string) {
  return `${statusCode}::${message}`
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).send(toHttpErrorMessage(405, 'Method Not Allowed'))
  }

  const { videoConfig, userConfig } = req.body as ChatBody
  if (!videoConfig || !userConfig) {
    return res.status(400).send(toHttpErrorMessage(400, 'Missing videoConfig or userConfig'))
  }

  try {
    const openaiApiKey = await selectOpenAICompatibleApiKey(userConfig.userKey)
    const baseUrl = await validateOpenAIBaseUrl(userConfig.baseUrl)
    const { openAiPayload } = await buildSummarizeOpenAIPayload({ videoConfig, userConfig })
    const streamResult = await fetchOpenAIResult({ ...openAiPayload, stream: true }, openaiApiKey, videoConfig, baseUrl)

    prepareTextStreamResponse(res)

    if (streamResult instanceof ReadableStream) {
      await writeWebStreamToNodeResponse(streamResult, res)
      return
    }

    res.status(200).send(streamResult)
  } catch (error: any) {
    const statusCode = getApiRequestStatus(error)
    const message = error?.message || 'Internal Server Error'
    console.error(message)
    res.status(statusCode).send(toHttpErrorMessage(statusCode, message))
  }
}
