import { env, pipeline } from '@huggingface/transformers'

type LoadMessage = {
  type: 'load'
  modelId: string
}

type TranscribeMessage = {
  type: 'transcribe'
  requestId: string
  audio: ArrayBuffer
  offset: number
}

type DisposeMessage = {
  type: 'dispose'
}

type WorkerRequest = LoadMessage | TranscribeMessage | DisposeMessage

type WhisperChunk = {
  text: string
  timestamp: [number, number]
}

type WhisperOutput = {
  text: string
  chunks?: WhisperChunk[]
}

let transcriber: Awaited<ReturnType<typeof pipeline<'automatic-speech-recognition'>>> | null = null
let loadedModelId = ''
let selectedDevice: 'webgpu' | 'wasm' = 'wasm'

const postError = (requestId: string | null, error: unknown) => {
  self.postMessage({
    type: 'error',
    requestId,
    message: error instanceof Error ? error.message : '本地语音转写失败',
  })
}

const loadModel = async (modelId: string) => {
  if (transcriber && loadedModelId === modelId) {
    self.postMessage({ type: 'ready', modelId, device: selectedDevice })
    return
  }

  transcriber?.dispose()
  transcriber = null
  loadedModelId = ''

  selectedDevice = typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm'
  if (selectedDevice === 'wasm' && env.backends.onnx.wasm) {
    env.backends.onnx.wasm.numThreads = 1
  }

  transcriber = await pipeline('automatic-speech-recognition', modelId, {
    device: selectedDevice,
    dtype: selectedDevice === 'webgpu' ? 'q4' : 'q8',
    progress_callback: (progress: any) => {
      self.postMessage({
        type: 'model-progress',
        status: progress.status,
        file: typeof progress.file === 'string' ? progress.file : null,
        progress: typeof progress.progress === 'number' ? progress.progress : null,
        loaded: typeof progress.loaded === 'number' ? progress.loaded : null,
        total: typeof progress.total === 'number' ? progress.total : null,
      })
    },
  })
  loadedModelId = modelId
  self.postMessage({ type: 'ready', modelId, device: selectedDevice })
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data
  if (message.type === 'dispose') {
    transcriber?.dispose()
    transcriber = null
    loadedModelId = ''
    self.close()
    return
  }

  if (message.type === 'load') {
    try {
      await loadModel(message.modelId)
    } catch (error) {
      postError(null, error)
    }
    return
  }

  if (!transcriber) {
    postError(message.requestId, new Error('本地语音模型尚未加载'))
    return
  }

  try {
    const output = (await transcriber(new Float32Array(message.audio), {
      language: 'chinese',
      task: 'transcribe',
      return_timestamps: true,
      force_full_sequences: false,
      temperature: 0,
    })) as WhisperOutput
    const chunks = (output.chunks || [])
      .map((chunk) => ({
        text: chunk.text.trim(),
        start: message.offset + Math.max(0, chunk.timestamp[0] || 0),
        end: message.offset + Math.max(chunk.timestamp[0] || 0, chunk.timestamp[1] || 0),
      }))
      .filter((chunk) => chunk.text)

    self.postMessage({
      type: 'transcript',
      requestId: message.requestId,
      text: output.text.trim(),
      chunks,
    })
  } catch (error) {
    postError(message.requestId, error)
  }
}
