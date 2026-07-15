import { zodResolver } from '@hookform/resolvers/zod'
import getVideoId from 'get-video-id'
import type { NextPage } from 'next'
import { useRouter } from 'next/router'
import React, { useEffect, useMemo, useState } from 'react'
import { SubmitHandler, useForm } from 'react-hook-form'
import useFormPersist from 'react-hook-form-persist'
import { CourseProgressPanel } from '~/components/course/CourseProgressPanel'
import { CourseResult } from '~/components/course/CourseResult'
import { useAnalytics } from '~/components/context/analytics'
import { PromptOptions } from '~/components/PromptOptions'
import { SubmitButton } from '~/components/SubmitButton'
import { TypingSlogan } from '~/components/TypingSlogan'
import { UserKeyInput } from '~/components/UserKeyInput'
import { useCourseWorkflow } from '~/hooks/useCourseWorkflow'
import { useOpenRouterModels } from '~/hooks/useOpenRouterModels'
import { useToast } from '~/hooks/use-toast'
import { useLocalStorage } from '~/hooks/useLocalStorage'
import { DEFAULT_ASR_MODEL } from '~/lib/course/localAsr'
import { VideoService } from '~/lib/types'
import { DEFAULT_LANGUAGE } from '~/utils/constants/language'
import { extractPage, extractUrl } from '~/utils/extractUrl'
import { getVideoIdFromUrl } from '~/utils/getVideoIdFromUrl'
import { VideoConfigSchema, videoConfigSchema } from '~/utils/schemas/video'

const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth'

function toBase64Url(bytes: Uint8Array) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function generatePkceVerifier(length = 64) {
  const randomBytes = new Uint8Array(length)
  window.crypto.getRandomValues(randomBytes)
  return toBase64Url(randomBytes)
}

async function generatePkceChallenge(verifier: string) {
  const encoded = new TextEncoder().encode(verifier)
  const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoded)
  return toBase64Url(new Uint8Array(hashBuffer))
}

export const Home: NextPage = () => {
  const router = useRouter()
  const urlState = router.query.slug
  const searchParams = useMemo(() => {
    const [, queryString = ''] = router.asPath.split('?')
    return new URLSearchParams(queryString)
  }, [router.asPath])
  const { register, handleSubmit, getValues, watch, setValue } = useForm<VideoConfigSchema>({
    defaultValues: {
      enableStream: true,
      model: '',
      showTimestamp: false,
      showEmoji: true,
      detailLevel: 600,
      sentenceNumber: 5,
      outlineLevel: 1,
      outputLanguage: DEFAULT_LANGUAGE,
    },
    resolver: zodResolver(videoConfigSchema),
  })

  // TODO: add mobx or state manager
  const [currentVideoUrl, setCurrentVideoUrl] = useState<string>('')
  const [userKey, setUserKey] = useLocalStorage<string>('user-openai-apikey')
  const [userBaseUrl, setUserBaseUrl] = useLocalStorage<string>('user-openai-base-url')
  const [storedModel, setStoredModel] = useLocalStorage<string>('user-openai-model', '')
  const [asrModel, setAsrModel] = useLocalStorage<string>('user-asr-model', DEFAULT_ASR_MODEL)
  const [oauthLoading, setOauthLoading] = useState(false)
  const [modelInitialized, setModelInitialized] = useState(false)
  const { models: openRouterModels, loading: modelLoading } = useOpenRouterModels()
  const course = useCourseWorkflow()
  const { toast } = useToast()
  const { analytics } = useAnalytics()

  useFormPersist('video-summary-config-storage', {
    watch,
    setValue,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined, // default window.sessionStorage
    exclude: ['model'],
  })
  const shouldShowTimestamp = getValues('showTimestamp')
  const currentModel = watch('model')

  useEffect(() => {
    if (modelInitialized) {
      return
    }
    if (storedModel?.trim()) {
      setValue('model', storedModel)
    }
    setModelInitialized(true)
  }, [modelInitialized, setValue, storedModel])

  useEffect(() => {
    if (modelInitialized) {
      setStoredModel(currentModel || '')
    }
  }, [currentModel, modelInitialized, setStoredModel])

  useEffect(() => {
    const suggestedModel = openRouterModels[0]?.id
    if (!modelInitialized || !suggestedModel) {
      return
    }
    if (!getValues('model')?.trim()) {
      setValue('model', suggestedModel)
    }
  }, [modelInitialized, openRouterModels, getValues, setValue])

  useEffect(() => {
    // https://www.youtube.com/watch?v=DHhOgWPKIKU
    const validatedUrl = getVideoIdFromUrl(router.isReady, currentVideoUrl, urlState, searchParams)

    if (validatedUrl) {
      setCurrentVideoUrl(validatedUrl)
    }
  }, [router.isReady, urlState, searchParams])

  useEffect(() => {
    if (!currentVideoUrl && course.job?.sourceUrl) {
      setCurrentVideoUrl(course.job.sourceUrl)
    }
  }, [course.job?.sourceUrl, currentVideoUrl])

  const validateUrlFromAddressBar = (url?: string) => {
    // note: auto refactor by ChatGPT
    const videoUrl = url || currentVideoUrl
    if (
      // https://www.bilibili.com/video/BV1AL4y1j7RY
      // https://www.bilibili.com/video/BV1854y1u7B8/?p=6
      // https://www.bilibili.com/video/av352747000
      // todo: b23.tv url with title
      // todo: any article url
      !(videoUrl.includes('bilibili.com/video') || videoUrl.includes('youtube.com') || videoUrl.includes('youtu.be/'))
    ) {
      toast({
        title: '暂不支持此视频链接',
        description: '请输入哔哩哔哩或 YouTube 视频链接；支持 b23.tv 短链接。',
      })
      return false
    }

    if (url) {
      setCurrentVideoUrl(videoUrl)
    }
    return true
  }
  const generateSummary = async (url?: string) => {
    const formValues = getValues()
    if (!validateUrlFromAddressBar(url)) {
      return
    }

    if (!userKey?.trim() || !formValues.model?.trim()) {
      toast({
        variant: 'destructive',
        title: '模型配置不完整',
        description: '请填写 API Key 和模型 ID。',
      })
      return
    }

    const videoUrl = url || currentVideoUrl
    const { id, service } = getVideoId(videoUrl)
    if (service === VideoService.Youtube && id) {
      try {
        await course.start(
          { videoId: id, service: VideoService.Youtube, ...formValues },
          { userKey, baseUrl: userBaseUrl, shouldShowTimestamp: shouldShowTimestamp },
          videoUrl,
          asrModel || DEFAULT_ASR_MODEL,
        )
      } catch (error) {
        toast({
          variant: 'destructive',
          title: '课程处理失败',
          description: error instanceof Error ? error.message : '请稍后重试',
        })
      }
      return
    }

    const videoId = extractUrl(videoUrl)
    if (!videoId) {
      return
    }

    const pageNumber = extractPage(videoUrl, searchParams)
    try {
      await course.start(
        { service: VideoService.Bilibili, videoId, pageNumber, ...formValues },
        { userKey, baseUrl: userBaseUrl, shouldShowTimestamp },
        videoUrl,
        asrModel || DEFAULT_ASR_MODEL,
      )
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '课程处理失败',
        description: error instanceof Error ? error.message : '请稍后重试',
      })
    }
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
    }, 10)
  }
  const onFormSubmit: SubmitHandler<VideoConfigSchema> = async () => {
    // e.preventDefault();
    await generateSummary(currentVideoUrl)
    analytics.track('GenerateButton Clicked')
  }
  const handleApiKeyChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setUserKey(e.target.value)
  }
  const handleBaseUrlChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    setUserBaseUrl(e.target.value)
  }
  const handleAsrModelChange: React.ChangeEventHandler<HTMLSelectElement> = (e) => {
    setAsrModel(e.target.value)
  }

  const handleOpenRouterOAuth = async () => {
    if (typeof window === 'undefined') {
      return
    }

    if (!window.crypto?.subtle) {
      toast({
        variant: 'destructive',
        title: '浏览器不支持 OAuth 授权',
        description: '请升级浏览器后重试。',
      })
      return
    }

    try {
      setOauthLoading(true)
      const codeVerifier = generatePkceVerifier()
      const codeChallenge = await generatePkceChallenge(codeVerifier)
      const state = generatePkceVerifier(32)
      const callbackUrl = `${window.location.origin}/openrouter/callback`
      sessionStorage.setItem('openrouter_oauth_state', state)
      sessionStorage.setItem('openrouter_oauth_code_verifier', codeVerifier)

      const params = new URLSearchParams({
        callback_url: callbackUrl,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
      })
      window.location.assign(`${OPENROUTER_AUTH_URL}?${params.toString()}`)
    } catch (error: any) {
      setOauthLoading(false)
      toast({
        variant: 'destructive',
        title: 'OpenRouter OAuth 初始化失败',
        description: error?.message || '请稍后重试',
      })
    }
  }

  const handleInputChange = async (e: any) => {
    const value = e.target.value
    const regex = /((?:https?:\/\/|www\.)\S+)/g
    const matches = value.match(regex)
    const detectedUrl = matches?.[0]?.replace(/[\])},，。]+$/, '') || value
    if (detectedUrl.includes('b23.tv')) {
      toast({ title: '正在解析 b23.tv 短链接...' })
      try {
        const response = await fetch(`/api/b23tv?url=${encodeURIComponent(detectedUrl)}`)
        const json = await response.json()
        if (!response.ok || typeof json.url !== 'string') {
          throw new Error(json.errorMessage || '短链接解析失败')
        }
        setCurrentVideoUrl(json.url)
      } catch (error: any) {
        setCurrentVideoUrl(value)
        toast({
          variant: 'destructive',
          title: 'b23.tv 短链接解析失败',
          description: error?.message || '请粘贴完整的 Bilibili 视频链接。',
        })
      }
    } else {
      setCurrentVideoUrl(detectedUrl)
    }
  }

  return (
    <div className="mt-10 w-full px-4 sm:mt-40 lg:px-0">
      <TypingSlogan />
      <UserKeyInput
        value={userKey}
        onChange={handleApiKeyChange}
        baseUrl={userBaseUrl}
        onBaseUrlChange={handleBaseUrlChange}
        oauthLoading={oauthLoading}
        onStartOpenRouterOAuth={handleOpenRouterOAuth}
      />
      <form onSubmit={handleSubmit(onFormSubmit)} className="grid place-items-center">
        <input
          type="text"
          value={currentVideoUrl}
          onChange={handleInputChange}
          className="mx-auto mt-10 w-full appearance-none rounded-lg rounded-md border bg-transparent py-2 pl-2 text-sm leading-6 text-slate-900 shadow-sm ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="输入哔哩哔哩或 YouTube 视频链接，按下回车"
        />
        <SubmitButton loading={course.running} label="生成课程笔记" />
        <PromptOptions
          getValues={getValues}
          register={register}
          modelOptions={openRouterModels}
          modelLoading={modelLoading}
          asrModel={asrModel || DEFAULT_ASR_MODEL}
          onAsrModelChange={handleAsrModelChange}
        />
      </form>
      <CourseProgressPanel
        job={course.job}
        progress={course.progress}
        running={course.running}
        onCancel={course.cancel}
        onResume={() => generateSummary(course.job?.sourceUrl || currentVideoUrl)}
      />
      {course.job?.status === 'complete' && course.job.notes && (
        <CourseResult job={course.job} onDelete={course.clear} />
      )}
    </div>
  )
}

export default Home
