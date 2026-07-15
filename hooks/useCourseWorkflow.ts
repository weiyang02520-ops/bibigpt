import { useCallback, useEffect, useRef, useState } from 'react'
import { chunkTranscript } from '~/lib/course/chunkTranscript'
import {
  deleteCourseJob,
  getCourseJobId,
  loadActiveCourseJob,
  loadCourseJob,
  saveCourseJob,
} from '~/lib/course/jobStore'
import { DEFAULT_ASR_MODEL, transcribeCourseAudio } from '~/lib/course/localAsr'
import {
  CourseChunkSummary,
  CourseJob,
  CourseNotes,
  CourseProgress,
  CourseSource,
  TranscriptSegment,
} from '~/lib/course/types'
import { UserConfig, VideoConfig } from '~/lib/types'

const toStoredSource = (source: CourseSource): Omit<CourseSource, 'audio'> => {
  const { audio: _audio, ...storedSource } = source
  return storedSource
}

const createFingerprint = (source: CourseSource, asrModel: string) => {
  const firstCaption = source.transcript[0]
  const lastCaption = source.transcript[source.transcript.length - 1]
  const captionMarker =
    source.mode === 'captions'
      ? `${source.transcript.length}:${firstCaption?.start || 0}:${firstCaption?.text || ''}:${lastCaption?.end || 0}:${
          lastCaption?.text || ''
        }`
      : ''
  const audioMarker = source.audio
    ? `${source.audio.url}:${source.audio.size || 0}:${source.audio.codec}:${source.audio.bandwidth}`
    : ''
  return `${source.service}:${source.videoId}:${source.pageNumber}:${source.duration}:${source.title}:${source.mode}:${
    source.mode === 'local-asr' ? asrModel : captionMarker
  }:${audioMarker}`
}

const isSameSource = (job: CourseJob, source: CourseSource) =>
  job.source.service === source.service &&
  job.source.videoId === source.videoId &&
  job.source.pageNumber === source.pageNumber &&
  job.source.duration === source.duration &&
  job.source.title === source.title &&
  job.source.mode === source.mode

const createJob = (source: CourseSource, sourceUrl: string, asrModel: string): CourseJob => ({
  version: 2,
  id: getCourseJobId(source.service, source.videoId, source.pageNumber),
  sourceFingerprint: createFingerprint(source, asrModel),
  sourceUrl,
  asrModel: source.mode === 'local-asr' ? asrModel : null,
  status: 'inspecting',
  source: toStoredSource(source),
  transcript: source.transcript,
  transcribedUntil: source.mode === 'captions' ? source.duration : 0,
  chunkSummaries: [],
  notes: null,
  error: null,
  updatedAt: new Date().toISOString(),
})

const postJson = async <T>(url: string, body: unknown, signal: AbortSignal): Promise<T> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(typeof json.error === 'string' ? json.error : `请求失败（HTTP ${response.status}）`)
  }
  return json as T
}

const mergeTranscript = (current: TranscriptSegment[], incoming: TranscriptSegment[]) => {
  const byId = new Map(current.map((segment) => [segment.id, segment]))
  incoming.forEach((segment) => byId.set(segment.id, segment))
  return Array.from(byId.values()).sort((left, right) => left.start - right.start || left.end - right.end)
}

export function useCourseWorkflow() {
  const [job, setJob] = useState<CourseJob | null>(null)
  const [source, setSource] = useState<CourseSource | null>(null)
  const [progress, setProgress] = useState<CourseProgress | null>(null)
  const [running, setRunning] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)

  const persist = useCallback(async (nextJob: CourseJob) => {
    const updated = { ...nextJob, updatedAt: new Date().toISOString() }
    setJob(updated)
    await saveCourseJob(updated)
    return updated
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  useEffect(() => {
    let active = true
    loadActiveCourseJob()
      .then((restored) => {
        if (!active || !restored) {
          return
        }
        setJob(restored)
        setSource({ ...restored.source, audio: null })
        if (restored.status === 'complete' && restored.notes) {
          setProgress({ status: 'complete', label: '课程笔记已完成', completed: 1, total: 1 })
        } else {
          setProgress({
            status: restored.status,
            label: '发现未完成的课程任务',
            completed: restored.status === 'transcribing' ? restored.transcribedUntil : restored.chunkSummaries.length,
            total:
              restored.status === 'transcribing'
                ? restored.source.duration
                : Math.max(1, restored.chunkSummaries.length + 1),
          })
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [])

  const clear = useCallback(async () => {
    if (!job) {
      return
    }
    runIdRef.current += 1
    abortRef.current?.abort()
    abortRef.current = null
    await deleteCourseJob(job.id)
    setJob(null)
    setSource(null)
    setProgress(null)
  }, [job])

  const start = useCallback(
    async (videoConfig: VideoConfig, userConfig: UserConfig, sourceUrl: string, asrModel = DEFAULT_ASR_MODEL) => {
      const runId = runIdRef.current + 1
      runIdRef.current = runId
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller
      const isCurrentRun = () => runIdRef.current === runId
      const updateProgress = (nextProgress: CourseProgress) => {
        if (isCurrentRun()) {
          setProgress(nextProgress)
        }
      }
      const persistCurrent = async (nextJob: CourseJob) => {
        if (!isCurrentRun()) {
          throw new DOMException('任务已被新请求替代', 'AbortError')
        }
        return persist(nextJob)
      }
      setRunning(true)
      updateProgress({ status: 'inspecting', label: '正在检查视频来源', completed: 0, total: 1 })

      let workingJob: CourseJob | null = null
      try {
        const inspectedSource = await postJson<CourseSource>(
          '/api/course/source',
          {
            service: videoConfig.service,
            videoId: videoConfig.videoId,
            pageNumber: Number(videoConfig.pageNumber || 1),
          },
          controller.signal,
        )
        if (!isCurrentRun()) {
          throw new DOMException('任务已被新请求替代', 'AbortError')
        }
        setSource(inspectedSource)
        const jobId = getCourseJobId(inspectedSource.service, inspectedSource.videoId, inspectedSource.pageNumber)
        const stored = await loadCourseJob(jobId)
        const fingerprint = createFingerprint(inspectedSource, asrModel)
        const reusableCompleted =
          stored &&
          stored.status === 'complete' &&
          stored.notes &&
          isSameSource(stored, inspectedSource) &&
          (inspectedSource.mode === 'captions' || stored.transcribedUntil >= inspectedSource.duration - 0.5)
        if (reusableCompleted) {
          workingJob = await persistCurrent({
            ...stored,
            version: 2,
            sourceFingerprint: fingerprint,
            sourceUrl: stored.sourceUrl || sourceUrl,
            asrModel: inspectedSource.mode === 'local-asr' ? stored.asrModel || asrModel : null,
            source: toStoredSource(inspectedSource),
          })
          updateProgress({ status: 'complete', label: '课程笔记已完成', completed: 1, total: 1 })
          return workingJob
        }
        workingJob =
          stored?.version === 2 && stored.sourceFingerprint === fingerprint
            ? {
                ...stored,
                sourceUrl: stored.sourceUrl || sourceUrl,
                asrModel: inspectedSource.mode === 'local-asr' ? asrModel : null,
                source: toStoredSource(inspectedSource),
              }
            : createJob(inspectedSource, sourceUrl, asrModel)
        workingJob = await persistCurrent({ ...workingJob, status: 'inspecting', error: null })

        if (inspectedSource.mode === 'local-asr') {
          const hasCompleteTranscript =
            workingJob.transcript.length > 0 && workingJob.transcribedUntil >= inspectedSource.duration - 0.5
          if (!hasCompleteTranscript) {
            if (!inspectedSource.audio) {
              throw new Error('视频没有字幕，也没有可用音频流')
            }
            workingJob = await persistCurrent({ ...workingJob, status: 'loading-asr' })
            updateProgress({ status: 'loading-asr', label: '正在准备本地语音模型', completed: 0, total: 100 })
            await transcribeCourseAudio({
              audio: inspectedSource.audio,
              startAt: workingJob.transcribedUntil,
              modelId: asrModel,
              signal: controller.signal,
              callbacks: {
                onModelProgress: (modelProgress) => {
                  updateProgress({
                    status: 'loading-asr',
                    label: modelProgress.file ? `正在准备 ${modelProgress.file}` : '正在准备本地语音模型',
                    completed: Math.max(0, Math.min(100, modelProgress.progress || 0)),
                    total: 100,
                  })
                },
                onModelReady: (device) => {
                  updateProgress({
                    status: 'transcribing',
                    label: device === 'webgpu' ? '正在使用 GPU 转写' : '正在使用 CPU 转写',
                    completed: workingJob?.transcribedUntil || 0,
                    total: inspectedSource.duration,
                  })
                },
                onWindowStart: (windowStart) => {
                  updateProgress({
                    status: 'transcribing',
                    label: '正在转写课程音频',
                    completed: windowStart,
                    total: inspectedSource.duration,
                  })
                },
                onWindowComplete: async (segments, completedUntil) => {
                  if (!workingJob) {
                    return
                  }
                  workingJob = await persistCurrent({
                    ...workingJob,
                    status: 'transcribing',
                    transcript: mergeTranscript(workingJob.transcript, segments),
                    transcribedUntil: completedUntil,
                  })
                },
              },
            })
          }
        }

        if (!workingJob || workingJob.transcript.length < 1) {
          throw new Error('没有生成可用于总结的转写文本')
        }

        const chunks = chunkTranscript(workingJob.transcript)
        if (chunks.length < 1) {
          throw new Error('课程文本无法分段')
        }
        workingJob = await persistCurrent({ ...workingJob, status: 'summarizing' })

        for (let index = 0; index < chunks.length; index += 1) {
          const chunk = chunks[index]
          const existing = workingJob.chunkSummaries.find(
            (summary) => summary.start === chunk.start && summary.end === chunk.end,
          )
          if (existing) {
            continue
          }
          updateProgress({
            status: 'summarizing',
            label: '正在整理分段笔记',
            completed: index,
            total: chunks.length,
          })
          const summary = await postJson<CourseChunkSummary>(
            '/api/course/summarize',
            {
              action: 'chunk',
              model: videoConfig.model,
              outputLanguage: videoConfig.outputLanguage || 'Chinese',
              title: inspectedSource.title,
              start: chunk.start,
              end: chunk.end,
              transcript: chunk.text,
              userConfig,
            },
            controller.signal,
          )
          workingJob = await persistCurrent({
            ...workingJob,
            chunkSummaries: [...workingJob.chunkSummaries, summary].sort((left, right) => left.start - right.start),
          })
        }

        workingJob = await persistCurrent({ ...workingJob, status: 'composing' })
        updateProgress({ status: 'composing', label: '正在合成完整课程笔记', completed: 0, total: 1 })
        const notes = await postJson<CourseNotes>(
          '/api/course/summarize',
          {
            action: 'compose',
            model: videoConfig.model,
            outputLanguage: videoConfig.outputLanguage || 'Chinese',
            title: inspectedSource.title,
            sourceUrl: workingJob.sourceUrl || sourceUrl,
            duration: inspectedSource.duration,
            chunkSummaries: workingJob.chunkSummaries,
            userConfig,
          },
          controller.signal,
        )
        workingJob = await persistCurrent({ ...workingJob, status: 'complete', notes, error: null })
        updateProgress({ status: 'complete', label: '课程笔记已完成', completed: 1, total: 1 })
        return workingJob
      } catch (error) {
        const isCancelled = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
        if (workingJob && isCurrentRun()) {
          await persist({
            ...workingJob,
            status: isCancelled ? 'cancelled' : 'failed',
            error: isCancelled ? null : error instanceof Error ? error.message : '课程处理失败',
          })
        }
        if (!isCancelled && isCurrentRun()) {
          throw error
        }
        return null
      } finally {
        if (isCurrentRun()) {
          setRunning(false)
          if (abortRef.current === controller) {
            abortRef.current = null
          }
        }
      }
    },
    [persist],
  )

  return { job, source, progress, running, start, cancel, clear }
}
