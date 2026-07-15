import { AudioBufferSink, CustomSource, Input, MP4, WrappedAudioBuffer } from 'mediabunny'
import { CourseAudioSource, TranscriptSegment } from '~/lib/course/types'

export const DEFAULT_ASR_MODEL = 'onnx-community/whisper-small'
const TARGET_SAMPLE_RATE = 16000
const WINDOW_SECONDS = 30
const RANGE_CHUNK_SIZE = 2 * 1024 * 1024

type ModelProgress = {
  status: string
  file: string | null
  progress: number | null
  loaded: number | null
  total: number | null
}

type AsrCallbacks = {
  onModelProgress: (progress: ModelProgress) => void
  onModelReady: (device: 'webgpu' | 'wasm') => void
  onWindowStart: (start: number, end: number) => void
  onWindowComplete: (segments: TranscriptSegment[], completedUntil: number) => Promise<void> | void
}

type PendingRequest = {
  resolve: (segments: TranscriptSegment[]) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

const mixToMono = (wrappedBuffers: WrappedAudioBuffer[]) => {
  if (wrappedBuffers.length < 1) {
    return { samples: new Float32Array(), sampleRate: TARGET_SAMPLE_RATE }
  }

  const sampleRate = wrappedBuffers[0].buffer.sampleRate
  const totalLength = wrappedBuffers.reduce((total, item) => total + item.buffer.length, 0)
  const samples = new Float32Array(totalLength)
  let writeOffset = 0

  for (const { buffer } of wrappedBuffers) {
    if (buffer.sampleRate !== sampleRate) {
      throw new Error('音频片段采样率不一致')
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index))
    for (let index = 0; index < buffer.length; index += 1) {
      let sum = 0
      for (const channel of channels) {
        sum += channel[index]
      }
      samples[writeOffset + index] = sum / channels.length
    }
    writeOffset += buffer.length
  }

  return { samples, sampleRate }
}

const resampleLinear = (input: Float32Array, sourceRate: number, targetRate: number) => {
  if (sourceRate === targetRate || input.length < 2) {
    return input
  }
  const outputLength = Math.max(1, Math.round((input.length * targetRate) / sourceRate))
  const output = new Float32Array(outputLength)
  const ratio = sourceRate / targetRate
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio
    const left = Math.min(input.length - 1, Math.floor(position))
    const right = Math.min(input.length - 1, left + 1)
    const weight = position - left
    output[index] = input[left] * (1 - weight) + input[right] * weight
  }
  return output
}

class CourseAsrWorker {
  private worker: Worker
  private pending = new Map<string, PendingRequest>()
  private disposed = false
  private readyResolve: ((device: 'webgpu' | 'wasm') => void) | null = null
  private readyReject: ((error: Error) => void) | null = null
  private readyTimeoutId: ReturnType<typeof setTimeout> | null = null
  private readyAbortCleanup: (() => void) | null = null
  private onProgress: (progress: ModelProgress) => void = () => undefined

  constructor() {
    this.worker = new Worker(new URL('../../workers/courseAsr.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = (event) => this.handleMessage(event.data)
    this.worker.onerror = (event) => {
      const error = new Error(event.message || '本地语音 worker 运行失败')
      this.settleReady({ error })
      this.pending.forEach((pending) => {
        clearTimeout(pending.timeoutId)
        pending.reject(error)
      })
      this.pending.clear()
    }
  }

  private settleReady(result: { device?: 'webgpu' | 'wasm'; error?: Error }) {
    const resolve = this.readyResolve
    const reject = this.readyReject
    this.readyResolve = null
    this.readyReject = null
    if (this.readyTimeoutId) {
      clearTimeout(this.readyTimeoutId)
      this.readyTimeoutId = null
    }
    this.readyAbortCleanup?.()
    this.readyAbortCleanup = null
    if (result.error) {
      reject?.(result.error)
    } else if (result.device) {
      resolve?.(result.device)
    }
  }

  private handleMessage(message: any) {
    if (message.type === 'model-progress') {
      this.onProgress(message as ModelProgress)
      return
    }
    if (message.type === 'ready') {
      this.settleReady({ device: message.device === 'webgpu' ? 'webgpu' : 'wasm' })
      return
    }
    if (message.type === 'error') {
      const error = new Error(message.message || '本地语音转写失败')
      if (message.requestId) {
        const pending = this.pending.get(message.requestId)
        if (pending) {
          clearTimeout(pending.timeoutId)
        }
        pending?.reject(error)
        this.pending.delete(message.requestId)
      } else {
        this.settleReady({ error })
      }
      return
    }
    if (message.type === 'transcript') {
      const pending = this.pending.get(message.requestId)
      if (!pending) {
        return
      }
      clearTimeout(pending.timeoutId)
      const chunks = Array.isArray(message.chunks) ? message.chunks : []
      const segments = chunks.map((chunk: any, index: number) => ({
        id: `asr-${message.requestId}-${index}`,
        start: Number(chunk.start) || 0,
        end: Number(chunk.end) || Number(chunk.start) || 0,
        text: String(chunk.text || '').trim(),
        source: 'asr' as const,
      }))
      if (segments.length < 1 && typeof message.text === 'string' && message.text.trim()) {
        segments.push({
          id: `asr-${message.requestId}-0`,
          start: 0,
          end: 0,
          text: message.text.trim(),
          source: 'asr',
        })
      }
      pending.resolve(segments)
      this.pending.delete(message.requestId)
    }
  }

  load(modelId: string, onProgress: (progress: ModelProgress) => void, signal: AbortSignal) {
    this.onProgress = onProgress
    return new Promise<'webgpu' | 'wasm'>((resolve, reject) => {
      if (this.disposed || signal.aborted) {
        reject(new DOMException('转写已取消', 'AbortError'))
        return
      }
      this.settleReady({ error: new DOMException('语音模型加载已被新请求替代', 'AbortError') })
      this.readyResolve = resolve
      this.readyReject = reject
      const abort = () => this.dispose(new DOMException('转写已取消', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      this.readyAbortCleanup = () => signal.removeEventListener('abort', abort)
      this.readyTimeoutId = setTimeout(
        () => this.dispose(new Error('本地语音模型加载超时，请检查网络后继续')),
        10 * 60 * 1000,
      )
      try {
        this.worker.postMessage({ type: 'load', modelId })
      } catch (error) {
        this.settleReady({ error: error instanceof Error ? error : new Error('无法启动本地语音模型') })
      }
    })
  }

  transcribe(audio: Float32Array, offset: number) {
    const requestId = `window-${Math.round(offset * 1000)}`
    return new Promise<TranscriptSegment[]>((resolve, reject) => {
      if (this.disposed) {
        reject(new DOMException('转写已取消', 'AbortError'))
        return
      }
      const previous = this.pending.get(requestId)
      if (previous) {
        clearTimeout(previous.timeoutId)
        previous.reject(new DOMException('语音片段已被重试替代', 'AbortError'))
        this.pending.delete(requestId)
      }
      const timeoutId = setTimeout(() => {
        const error = new Error(`本地语音模型处理 ${Math.round(offset)} 秒片段超时`)
        this.pending.get(requestId)?.reject(error)
        this.pending.delete(requestId)
        this.dispose(error)
      }, 180000)
      this.pending.set(requestId, { resolve, reject, timeoutId })
      this.worker.postMessage({ type: 'transcribe', requestId, audio: audio.buffer, offset }, [audio.buffer])
    })
  }

  dispose(reason: Error = new DOMException('转写已取消', 'AbortError')) {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.settleReady({ error: reason })
    this.pending.forEach((pending) => {
      clearTimeout(pending.timeoutId)
      pending.reject(reason)
    })
    this.pending.clear()
    try {
      this.worker.postMessage({ type: 'dispose' })
    } catch {
      // The worker may already have stopped after an initialization error.
    }
    this.worker.terminate()
  }
}

export async function transcribeCourseAudio(params: {
  audio: CourseAudioSource
  startAt: number
  modelId?: string
  signal: AbortSignal
  callbacks: AsrCallbacks
}) {
  const source = new CustomSource({
    maxCacheSize: 16 * 1024 * 1024,
    prefetchProfile: 'network',
    getSize: async () => {
      const response = await fetch(params.audio.url, { method: 'HEAD', signal: params.signal })
      const size = Number(response.headers.get('content-length'))
      if (!response.ok || !Number.isSafeInteger(size) || size < 1) {
        throw new Error('无法读取音频大小')
      }
      return size
    },
    read: async (start, end) => {
      const output = new Uint8Array(end - start)
      let cursor = start
      while (cursor < end) {
        const chunkEnd = Math.min(end, cursor + RANGE_CHUNK_SIZE)
        const response = await fetch(params.audio.url, {
          headers: { Range: `bytes=${cursor}-${chunkEnd - 1}` },
          signal: params.signal,
        })
        if (response.status !== 206) {
          throw new Error(`音频分段读取失败（HTTP ${response.status}）`)
        }
        const chunk = new Uint8Array(await response.arrayBuffer())
        if (chunk.length !== chunkEnd - cursor) {
          throw new Error('音频分段长度不完整')
        }
        output.set(chunk, cursor - start)
        cursor = chunkEnd
      }
      return output
    },
  })
  const input = new Input({ formats: [MP4], source })
  const worker = new CourseAsrWorker()
  const abort = () => {
    input.dispose()
    worker.dispose(new DOMException('转写已取消', 'AbortError'))
  }
  params.signal.addEventListener('abort', abort, { once: true })

  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) {
      throw new Error('音频流没有可解码的音轨')
    }
    if (!(await track.canDecode())) {
      throw new Error('当前浏览器不能解码该视频的 AAC 音频，请使用最新版 Chrome 或 Edge')
    }

    const device = await worker.load(
      params.modelId || DEFAULT_ASR_MODEL,
      params.callbacks.onModelProgress,
      params.signal,
    )
    params.callbacks.onModelReady(device)
    const sink = new AudioBufferSink(track)
    const startAt = Math.max(0, Math.min(params.startAt, params.audio.duration))

    for (let start = startAt; start < params.audio.duration; start += WINDOW_SECONDS) {
      if (params.signal.aborted) {
        throw new DOMException('转写已取消', 'AbortError')
      }
      const end = Math.min(params.audio.duration, start + WINDOW_SECONDS)
      params.callbacks.onWindowStart(start, end)
      const buffers: WrappedAudioBuffer[] = []
      for await (const wrapped of sink.buffers(start, end)) {
        buffers.push(wrapped)
      }
      if (buffers.length < 1) {
        throw new Error(`无法解码 ${Math.floor(start)} 秒附近的音频`)
      }

      const mixed = mixToMono(buffers)
      const audio = resampleLinear(mixed.samples, mixed.sampleRate, TARGET_SAMPLE_RATE)
      const segments = await worker.transcribe(audio, start)
      await params.callbacks.onWindowComplete(
        segments.map((segment) => ({
          ...segment,
          start: segment.start || start,
          end: segment.end > segment.start ? segment.end : end,
        })),
        end,
      )
    }
  } catch (error) {
    if (params.signal.aborted) {
      throw new DOMException('转写已取消', 'AbortError')
    }
    throw error
  } finally {
    params.signal.removeEventListener('abort', abort)
    worker.dispose()
    if (!input.disposed) {
      input.dispose()
    }
  }
}
