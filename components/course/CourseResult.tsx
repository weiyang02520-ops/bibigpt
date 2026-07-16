import { BookOpen, Captions, Copy, Download, FileUp, Images, Trash2 } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { useToast } from '~/hooks/use-toast'
import { formatTimestamp } from '~/lib/course/chunkTranscript'
import {
  buildCourseMarkdown,
  downloadObsidianBundle,
  FrameReference,
  selectCourseFrames,
} from '~/lib/course/obsidianExport'
import { CourseJob } from '~/lib/course/types'
import { VideoService } from '~/lib/types'

type View = 'notes' | 'transcript' | 'frames'

const Frame = ({ frame, reason }: { frame: FrameReference; reason: string }) => {
  const x = frame.columns > 1 ? (frame.column / (frame.columns - 1)) * 100 : 0
  const y = frame.rows > 1 ? (frame.row / (frame.rows - 1)) * 100 : 0
  return (
    <figure className="overflow-hidden rounded-md border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div
        className="aspect-video w-full bg-cover bg-no-repeat"
        style={{
          backgroundImage: `url(${JSON.stringify(frame.imageUrl)})`,
          backgroundSize: `${frame.columns * 100}% ${frame.rows * 100}%`,
          backgroundPosition: `${x}% ${y}%`,
        }}
        role="img"
        aria-label={`${formatTimestamp(frame.timestamp)} 关键画面`}
      />
      <figcaption className="p-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
        <span className="font-semibold text-slate-900 dark:text-slate-100">{formatTimestamp(frame.timestamp)}</span>{' '}
        {reason}
      </figcaption>
    </figure>
  )
}

export function CourseResult({ job, onDelete }: { job: CourseJob; onDelete: () => void }) {
  const [view, setView] = useState<View>('notes')
  const [exporting, setExporting] = useState<'new' | 'update' | null>(null)
  const vaultInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()
  const frames = useMemo(() => selectCourseFrames(job), [job])

  if (!job.notes) {
    return null
  }

  const sourceUrl =
    job.sourceUrl ||
    (job.source.service === VideoService.Bilibili
      ? `https://www.bilibili.com/video/${job.source.videoId}`
      : `https://www.youtube.com/watch?v=${job.source.videoId}`)

  const copyMarkdown = async () => {
    await navigator.clipboard.writeText(buildCourseMarkdown(job, sourceUrl))
    toast({ description: '课程笔记已复制。' })
  }

  const exportObsidian = async (existingZip?: File) => {
    try {
      setExporting(existingZip ? 'update' : 'new')
      const result = await downloadObsidianBundle(job, sourceUrl, existingZip)
      const proposalCount = result.conflicts.filter((artifact) => artifact.status === 'conflict').length
      const modifiedCount = result.conflicts.filter((artifact) => artifact.status === 'modified').length
      toast({
        description:
          proposalCount > 0
            ? `Vault 已更新，${proposalCount} 个用户修改已保留，新版本写入 .bibigpt-new。`
            : modifiedCount > 0
            ? `Vault 已更新，并保留了其他课程中的 ${modifiedCount} 个用户修改。`
            : existingZip
            ? 'Obsidian Vault 已安全更新。'
            : 'Obsidian Vault 已生成。',
      })
    } catch (error) {
      toast({
        variant: 'destructive',
        title: '导出失败',
        description: error instanceof Error ? error.message : '请稍后重试',
      })
    } finally {
      setExporting(null)
    }
  }

  const tabs: Array<{ id: View; label: string; icon: typeof BookOpen }> = [
    { id: 'notes', label: '笔记', icon: BookOpen },
    { id: 'transcript', label: '转写', icon: Captions },
    { id: 'frames', label: '画面', icon: Images },
  ]

  return (
    <section className="mx-auto mb-12 mt-10 w-full max-w-5xl border-t border-slate-200 pt-8 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-950 dark:text-white">{job.notes.title}</h2>
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block text-sm text-sky-700 hover:underline"
          >
            {job.source.title}
          </a>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyMarkdown}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            title="复制 Markdown"
            aria-label="复制 Markdown"
          >
            <Copy className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => exportObsidian()}
            disabled={exporting !== null}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-wait disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting === 'new' ? '正在导出' : '新建 Vault'}
          </button>
          <input
            ref={vaultInputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-label="选择已有 BibiGPT Vault ZIP"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) {
                void exportObsidian(file)
              }
            }}
          />
          <button
            type="button"
            onClick={() => vaultInputRef.current?.click()}
            disabled={exporting !== null}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <FileUp className="h-4 w-4" aria-hidden="true" />
            {exporting === 'update' ? '正在更新' : '更新 Vault'}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:border-slate-600 dark:hover:bg-slate-800"
            title="删除本地记录"
            aria-label="删除本地记录"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="mt-7 inline-flex rounded-md bg-slate-100 p-1 dark:bg-slate-800" role="tablist">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              onClick={() => setView(tab.id)}
              className={`inline-flex h-9 items-center gap-2 rounded px-3 text-sm font-medium transition ${
                view === tab.id
                  ? 'bg-white text-slate-950 shadow-sm dark:bg-slate-950 dark:text-white'
                  : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {view === 'notes' && (
        <div className="mt-7 space-y-9">
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">课程概览</h3>
            <p className="mt-3 whitespace-pre-wrap leading-8 text-slate-700 dark:text-slate-300">
              {job.notes.overview}
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-950 dark:text-white">章节笔记</h3>
            <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {job.notes.chapters.map((chapter, index) => (
                <article key={`${chapter.timestamp}-${index}`} className="py-5">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <span className="font-mono text-sm font-semibold text-sky-700 dark:text-sky-400">
                      {formatTimestamp(chapter.timestamp)}
                    </span>
                    <h4 className="font-semibold text-slate-950 dark:text-white">{chapter.title}</h4>
                  </div>
                  <p className="mt-2 leading-7 text-slate-700 dark:text-slate-300">{chapter.summary}</p>
                  <ul className="mt-3 list-disc space-y-2 pl-5 text-slate-600 dark:text-slate-400">
                    {chapter.details.map((detail, detailIndex) => (
                      <li key={detailIndex}>{detail}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
          <div className="grid gap-8 md:grid-cols-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">核心要点</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 leading-7 text-slate-700 dark:text-slate-300">
                {job.notes.takeaways.map((takeaway, index) => (
                  <li key={index}>{takeaway}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-950 dark:text-white">术语</h3>
              <dl className="mt-3 space-y-3">
                {job.notes.terms.map((term, index) => (
                  <div key={`${term.term}-${index}`}>
                    <dt className="font-semibold text-slate-900 dark:text-slate-100">{term.term}</dt>
                    <dd className="mt-1 leading-7 text-slate-600 dark:text-slate-400">{term.explanation}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      )}

      {view === 'transcript' && (
        <div className="mt-7 max-h-[70vh] overflow-y-auto border-y border-slate-200 py-2 dark:border-slate-700">
          {job.transcript.map((segment) => (
            <p key={segment.id} className="grid grid-cols-[4.5rem_1fr] gap-3 py-2 text-sm leading-6">
              <span className="font-mono text-sky-700 dark:text-sky-400">{formatTimestamp(segment.start)}</span>
              <span className="text-slate-700 dark:text-slate-300">{segment.text}</span>
            </p>
          ))}
        </div>
      )}

      {view === 'frames' && (
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          {frames.length > 0 ? (
            frames.map((item, index) => <Frame key={`${item.frame.timestamp}-${index}`} {...item} />)
          ) : (
            <p className="text-sm text-slate-500">当前来源没有可用关键画面。</p>
          )}
        </div>
      )}
    </section>
  )
}
