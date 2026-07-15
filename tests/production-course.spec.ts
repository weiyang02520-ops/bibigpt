import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'

const SITE_URL = 'https://bibigpt-six.vercel.app'
const VIDEO_URL = 'https://www.bilibili.com/video/BV1ySLc6QEcB'
const ARTIFACT_DIR = 'artifacts/production-course'
const MAX_RUNTIME_MS = 150 * 60 * 1000

type StoredJob = {
  status?: string
  error?: string | null
  transcribedUntil?: number
  transcript?: unknown[]
  chunkSummaries?: unknown[]
  notes?: {
    title?: string
    chapters?: unknown[]
    keyMoments?: unknown[]
  } | null
  source?: {
    duration?: number
    frames?: { images?: string[]; timestamps?: number[] } | null
  }
}

async function readStoredJob(page: Page): Promise<StoredJob | null> {
  return page.evaluate(async () => {
    const request = <T>(value: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        value.onsuccess = () => resolve(value.result)
        value.onerror = () => reject(value.error)
      })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('keyval-store')
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const activeTransaction = database.transaction('keyval', 'readonly')
      const activeJobId = await request(activeTransaction.objectStore('keyval').get('bibigpt-course-active-job'))
      if (typeof activeJobId !== 'string' || !activeJobId) {
        return null
      }
      const jobTransaction = database.transaction('keyval', 'readonly')
      return (await request(
        jobTransaction.objectStore('keyval').get(`bibigpt-course-job:${activeJobId}`),
      )) as StoredJob | null
    } finally {
      database.close()
    }
  })
}

test.use({
  channel: 'chrome',
  launchOptions: { args: ['--disable-webgpu'] },
  viewport: { width: 1440, height: 1000 },
})

test('completes the production Bilibili course workflow', async ({ page }) => {
  test.setTimeout(MAX_RUNTIME_MS)
  await mkdir(ARTIFACT_DIR, { recursive: true })

  page.on('console', (message) => console.log(`[browser:${message.type()}] ${message.text()}`))
  page.on('pageerror', (error) => console.error(`[browser:error] ${error.message}`))
  page.on('requestfailed', (request) =>
    console.error(`[browser:requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`),
  )
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.error(`[browser:response] ${response.status()} ${response.url()}`)
    }
  })

  let chunkCount = 0
  await page.route('**/api/course/summarize', async (route) => {
    const request = route.request().postDataJSON() as Record<string, any>
    if (request.action === 'chunk') {
      chunkCount += 1
      const timestamp = Math.max(request.start, Math.min(request.end, request.start + 90))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          start: request.start,
          end: request.end,
          title: `课程分段 ${chunkCount}`,
          summary: `已完成第 ${chunkCount} 个真实转写分段的验收总结。`,
          keyPoints: [`分段 ${chunkCount} 包含可用的语音转写文本。`],
          terms: [{ term: `术语 ${chunkCount}`, explanation: '来自生产课程流水线的结构化验收数据。' }],
          keyMoments: [{ timestamp, reason: `第 ${chunkCount} 个分段的重要画面。` }],
        }),
      })
      return
    }

    const summaries = Array.isArray(request.chunkSummaries) ? request.chunkSummaries : []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'Git + GitHub 课程笔记验收',
        overview: '指定 Bilibili 课程已完成本地语音转写、分段处理和结构化笔记合成。',
        chapters: summaries.map((summary: any, index: number) => ({
          timestamp: summary.start,
          title: summary.title || `课程分段 ${index + 1}`,
          summary: summary.summary || '已完成分段总结。',
          details:
            Array.isArray(summary.keyPoints) && summary.keyPoints.length > 0 ? summary.keyPoints : ['验收完成。'],
        })),
        takeaways: ['课程音频按 30 秒窗口转写，长文本随后按段总结。'],
        terms: [{ term: 'Git', explanation: '分布式版本控制系统。' }],
        keyMoments: summaries.slice(0, 8).map((summary: any, index: number) => ({
          timestamp: summary.keyMoments?.[0]?.timestamp ?? summary.start,
          reason: `课程关键画面 ${index + 1}`,
        })),
      }),
    })
  })

  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForFunction(
    () => {
      const input = document.querySelector('#user-api-key')
      return Boolean(input && Object.keys(input).some((key) => key.startsWith('__reactProps$')))
    },
    undefined,
    { timeout: 60_000 },
  )
  const apiKeyInput = page.locator('#user-api-key')
  await apiKeyInput.fill('mock-key')
  await page.locator('#user-api-base-url').fill('https://mock.invalid/v1')
  await page.locator('#model').fill('mock-model')
  await page.locator('#asrModel').selectOption('onnx-community/whisper-base')
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('user-openai-apikey')))
    .toBe(JSON.stringify('mock-key'))
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('user-openai-base-url')))
    .toBe(JSON.stringify('https://mock.invalid/v1'))
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('user-openai-model')))
    .toBe(JSON.stringify('mock-model'))
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('user-asr-model')))
    .toBe(JSON.stringify('onnx-community/whisper-base'))

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('#user-api-key')).toHaveValue('mock-key', { timeout: 15_000 })
  await expect(page.locator('#user-api-base-url')).toHaveValue('https://mock.invalid/v1', { timeout: 15_000 })
  await expect(page.locator('#model')).toHaveValue('mock-model', { timeout: 15_000 })
  await expect(page.locator('#asrModel')).toHaveValue('onnx-community/whisper-base', { timeout: 15_000 })

  const videoInput = page.locator('form > input[type="text"]')
  await expect(videoInput).toHaveCount(1)
  await videoInput.fill(VIDEO_URL)
  await page.locator('button[type="submit"]').click()

  const startedAt = Date.now()
  let lastLogAt = 0
  let job: StoredJob | null = null
  while (Date.now() - startedAt < MAX_RUNTIME_MS - 60_000) {
    await page.waitForTimeout(15_000)
    job = await readStoredJob(page)
    if (Date.now() - lastLogAt >= 60_000) {
      console.log(
        JSON.stringify({
          status: job?.status,
          transcribedUntil: job?.transcribedUntil,
          transcriptSegments: job?.transcript?.length,
          chunkSummaries: job?.chunkSummaries?.length,
          elapsedMinutes: Math.round((Date.now() - startedAt) / 60_000),
        }),
      )
      lastLogAt = Date.now()
    }
    if (job?.status === 'failed') {
      throw new Error(job.error || 'Production course job failed')
    }
    if (job?.status === 'complete') {
      break
    }
  }

  expect(job?.status).toBe('complete')
  expect(job?.source?.duration).toBeGreaterThan(2500)
  expect(job?.transcribedUntil).toBeGreaterThan(2569)
  expect(job?.transcript?.length).toBeGreaterThan(20)
  expect(job?.chunkSummaries?.length).toBeGreaterThan(1)
  expect(job?.notes?.chapters?.length).toBeGreaterThan(1)
  expect(job?.notes?.keyMoments?.length).toBeGreaterThanOrEqual(3)
  expect(job?.source?.frames?.images?.length).toBeGreaterThan(0)
  expect(job?.source?.frames?.timestamps?.length).toBeGreaterThan(100)

  await writeFile(`${ARTIFACT_DIR}/result.json`, JSON.stringify(job, null, 2), 'utf8')
  await expect(page.getByRole('heading', { name: 'Git + GitHub 课程笔记验收' })).toBeVisible()

  const framesTab = page.getByRole('button', { name: '画面' })
  await expect(framesTab).toHaveCount(1)
  await framesTab.click()
  await expect(page.locator('[role="img"][aria-label*="关键画面"]')).toHaveCount(8)
  await page.screenshot({ path: `${ARTIFACT_DIR}/course-result.png`, fullPage: false })

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Obsidian' }).click()
  const download = await downloadPromise
  await download.saveAs(`${ARTIFACT_DIR}/course-notes.zip`)
})
