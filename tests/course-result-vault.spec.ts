import { expect, test } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import JSZip from 'jszip'

const SITE_URL = process.env.BIBIGPT_TEST_URL || 'http://127.0.0.1:3001'
const ARTIFACT_DIR = 'artifacts/course-result-vault'

const transcript = [
  { id: 'fixture-1', start: 0, end: 60, text: '第一段课程转写。', source: 'caption' },
  { id: 'fixture-2', start: 60, end: 120, text: '第二段课程转写。', source: 'caption' },
]

const job = {
  version: 2,
  id: 'bilibili:BV1VaultUiTest:1',
  sourceFingerprint: 'fixture-fingerprint',
  sourceUrl: 'https://www.bilibili.com/video/BV1VaultUiTest',
  asrModel: null,
  status: 'complete',
  source: {
    service: 'bilibili',
    videoId: 'BV1VaultUiTest',
    pageNumber: 1,
    title: 'Vault 界面验收课程',
    duration: 120,
    mode: 'captions',
    transcript,
    frames: null,
  },
  transcript,
  transcribedUntil: 120,
  chunkSummaries: [
    {
      start: 0,
      end: 120,
      title: '完整分段',
      summary: '用于本地界面验收的分段总结。',
      keyPoints: ['关键点'],
      terms: [{ term: 'Vault', explanation: 'Obsidian 知识库目录。' }],
      keyMoments: [],
    },
  ],
  notes: {
    title: 'Vault 界面验收课程',
    overview: '验证课程结果页在桌面和手机宽度下可以新建及更新 Obsidian Vault。',
    chapters: [
      { timestamp: 0, title: '导出结构', summary: '固定 Vault 根目录。', details: ['包含索引、笔记和转写。'] },
      { timestamp: 60, title: '更新保护', summary: '保留用户编辑。', details: ['冲突内容写入新文件。'] },
    ],
    takeaways: ['Vault 可以重复更新。'],
    terms: [{ term: 'manifest', explanation: '记录来源、进度和文件所有权。' }],
    keyMoments: [],
  },
  error: null,
  updatedAt: '2026-07-16T02:00:00.000Z',
}

test.use({ channel: 'chrome', viewport: { width: 1440, height: 1000 } })

test('renders and updates an Obsidian Vault on desktop and mobile', async ({ page }) => {
  await mkdir(ARTIFACT_DIR, { recursive: true })
  await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' })
  await page.evaluate(async (storedJob) => {
    const request = <T>(value: IDBRequest<T>) =>
      new Promise<T>((resolve, reject) => {
        value.onsuccess = () => resolve(value.result)
        value.onerror = () => reject(value.error)
      })
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open('keyval-store')
      open.onupgradeneeded = () => {
        if (!open.result.objectStoreNames.contains('keyval')) open.result.createObjectStore('keyval')
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      const transaction = database.transaction('keyval', 'readwrite')
      const store = transaction.objectStore('keyval')
      await request(store.put(storedJob, `bibigpt-course-job:${storedJob.id}`))
      await request(store.put(storedJob.id, 'bibigpt-course-active-job'))
    } finally {
      database.close()
    }
  }, job)
  await page.reload({ waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Vault 界面验收课程' })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建 Vault' })).toBeVisible()
  await expect(page.getByRole('button', { name: '更新 Vault' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `${ARTIFACT_DIR}/desktop.png`, fullPage: true })

  const firstDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '新建 Vault' }).click()
  const firstDownload = await firstDownloadPromise
  const initialPath = `${ARTIFACT_DIR}/initial.zip`
  await firstDownload.saveAs(initialPath)

  const updateDownloadPromise = page.waitForEvent('download')
  await page.getByLabel('选择已有 BibiGPT Vault ZIP').setInputFiles(initialPath)
  const updateDownload = await updateDownloadPromise
  const updatedPath = `${ARTIFACT_DIR}/updated.zip`
  await updateDownload.saveAs(updatedPath)

  const updatedZip = await JSZip.loadAsync(await readFile(updatedPath))
  const manifest = JSON.parse(await updatedZip.file('BibiGPT-Vault/manifest.json')!.async('string')) as {
    lessons: unknown[]
    artifacts: Array<{ status: string }>
  }
  expect(manifest.lessons).toHaveLength(1)
  expect(manifest.artifacts.every((artifact) => artifact.status === 'generated')).toBe(true)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: '新建 Vault' })).toBeVisible()
  await expect(page.getByRole('button', { name: '更新 Vault' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.getByRole('tab', { name: '转写' }).click()
  await page.screenshot({ path: `${ARTIFACT_DIR}/mobile.png`, fullPage: true })
})
