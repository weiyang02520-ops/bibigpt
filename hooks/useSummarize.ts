import { useChat } from '@ai-sdk/react'
import { TextStreamChatTransport } from 'ai'
import { useEffect, useMemo } from 'react'
import { useToast } from '~/hooks/use-toast'
import { UserConfig, VideoConfig } from '~/lib/types'

function parseBackendErrorMessage(message: string) {
  const matcher = message.match(/^(\d{3})::([\s\S]*)$/)
  if (!matcher) {
    return { statusCode: 0, detail: message }
  }

  return {
    statusCode: Number(matcher[1]),
    detail: matcher[2].trim(),
  }
}

function extractLatestAssistantText(messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>) {
  const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')
  if (!assistantMessage) {
    return ''
  }

  return assistantMessage.parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('')
}

export function useSummarize() {
  const { toast } = useToast()
  const transport = useMemo(() => new TextStreamChatTransport({ api: '/api/chat' }), [])
  const { messages, status, error, sendMessage, setMessages } = useChat({
    transport,
  })

  const loading = status === 'submitted' || status === 'streaming'
  const summary = useMemo(() => extractLatestAssistantText(messages), [messages])

  useEffect(() => {
    if (!error) {
      return
    }

    const { statusCode, detail } = parseBackendErrorMessage(error.message || 'Unknown error')
    if (statusCode === 400) {
      toast({
        variant: 'destructive',
        title: '模型配置不完整',
        description: detail || '请检查 API Key、Base URL 和模型 ID。',
      })
      return
    }

    if (statusCode === 422) {
      toast({
        title: '没有找到可用字幕',
        description: detail || '请确认该视频已提供可访问的字幕。',
      })
      return
    }

    if (statusCode === 504) {
      toast({
        variant: 'destructive',
        title: '请求超时',
        description: detail || '字幕或模型服务暂时没有响应，请稍后重试。',
      })
      return
    }

    if (statusCode === 401 || statusCode === 403) {
      toast({
        variant: 'destructive',
        title: 'API Key 验证失败',
        description: detail || '请检查 API Key、Base URL 和模型 ID。',
      })
      return
    }

    if (statusCode === 429) {
      toast({
        variant: 'destructive',
        title: '请求过于频繁',
        description: detail || '字幕或模型服务触发了频率限制，请稍后重试。',
      })
      return
    }

    if (statusCode === 502) {
      toast({
        variant: 'destructive',
        title: '上游服务请求失败',
        description: detail || '请检查视频字幕是否可访问，以及模型服务配置是否正确。',
      })
      return
    }

    toast({
      variant: 'destructive',
      title: 'API 请求出错，请重试。',
      description: detail || error.message,
    })
  }, [error, toast])

  const resetSummary = () => {
    setMessages([])
  }

  const summarize = async (videoConfig: VideoConfig, userConfig: UserConfig) => {
    setMessages([])
    try {
      await sendMessage(
        {
          text: `Summarize video ${videoConfig.videoId}`,
        },
        {
          body: {
            videoConfig,
            userConfig,
          },
        },
      )
    } catch {
      // error state is handled by useChat and the effect above.
    }
  }

  return { loading, summary, resetSummary, summarize }
}
