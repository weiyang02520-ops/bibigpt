import { createServer } from 'node:http'

const port = Number(process.env.MOCK_OPENAI_PORT || 4010)
const expectedTranscriptMarker = 'never gonna'
let completionRequestCount = 0

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk) => {
      body += chunk
      if (body.length > 2_000_000) {
        reject(new Error('Request body is too large'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

function streamCompletion(response, model) {
  const chunks = [
    '## 本地端到端验收成功\n\n',
    '- 已从真实 YouTube 链接取得字幕。\n',
    '- 已将字幕发送到 OpenAI-compatible 接口。\n',
    '- 网页已收到流式总结结果。',
  ]

  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
  })

  chunks.forEach((content, index) => {
    setTimeout(() => {
      response.write(
        `data: ${JSON.stringify({
          id: 'mock-bibigpt-e2e',
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        })}\n\n`,
      )

      if (index === chunks.length - 1) {
        response.write(
          `data: ${JSON.stringify({
            id: 'mock-bibigpt-e2e',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model,
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          })}\n\n`,
        )
        response.end('data: [DONE]\n\n')
      }
    }, index * 80)
  })
}

const server = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return sendJson(response, 200, { ok: true, completionRequestCount })
  }

  if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
    return sendJson(response, 404, { error: { message: 'Not Found' } })
  }

  try {
    completionRequestCount += 1
    const payload = await readJsonBody(request)
    const prompt = Array.isArray(payload?.messages)
      ? payload.messages
          .map((message) => String(message?.content || ''))
          .join('\n')
          .toLowerCase()
      : ''

    if (!prompt.includes(expectedTranscriptMarker)) {
      return sendJson(response, 422, {
        error: { message: 'The request did not contain the expected real transcript marker.' },
      })
    }

    if (payload.stream) {
      return streamCompletion(response, payload.model || 'mock-bibigpt')
    }

    return sendJson(response, 200, {
      id: 'mock-bibigpt-e2e',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: payload.model || 'mock-bibigpt',
      choices: [
        {
          index: 0,
          finish_reason: 'stop',
          message: { role: 'assistant', content: '本地端到端验收成功：已收到真实视频字幕。' },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
  } catch (error) {
    return sendJson(response, 400, { error: { message: error?.message || 'Invalid request' } })
  }
})

server.listen(port, '127.0.0.1', () => {
  console.log(`Mock OpenAI-compatible API listening on http://127.0.0.1:${port}/v1`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
