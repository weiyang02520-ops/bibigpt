import { Copy, ExternalLink, NotebookPen } from 'lucide-react'
import Link from 'next/link'
import React from 'react'
import { SaveNoteButton } from '~/components/SaveNoteButton'
import { useSaveToFlomo } from '~/hooks/notes/flomo'
import useSaveToLark from '~/hooks/notes/lark'
import { useLocalStorage } from '~/hooks/useLocalStorage'

export function ActionsAfterResult({
  curVideo,
  onCopy,
  summaryNote,
}: {
  curVideo: string
  summaryNote: string
  onCopy: () => void
}) {
  const [flomoWebhook] = useLocalStorage<string>('user-flomo-webhook')
  const [larkWebhook] = useLocalStorage<string>('user-lark-webhook')
  const { loading: flomoLoading, save: flomoSave } = useSaveToFlomo(summaryNote, curVideo, flomoWebhook || '')
  const { loading: larkLoading, save: larkSave } = useSaveToLark(summaryNote, curVideo, larkWebhook || '')
  const hasNoteSetting = flomoWebhook || larkWebhook

  return (
    <div className="mx-auto mt-7 flex max-w-3xl flex-wrap justify-end gap-2">
      <a
        href={curVideo}
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
        回到视频
      </a>
      <button
        type="button"
        className="inline-flex min-h-10 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
        onClick={onCopy}
      >
        <Copy className="h-4 w-4" aria-hidden="true" />
        复制总结
      </button>
      {!hasNoteSetting ? (
        <Link
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
          href="/user/integration"
        >
          <NotebookPen className="h-4 w-4" aria-hidden="true" />
          配置笔记同步
        </Link>
      ) : (
        <>
          {flomoWebhook && <SaveNoteButton onSave={flomoSave} loading={flomoLoading} text="一键保存到 Flomo" />}
          {larkWebhook && <SaveNoteButton onSave={larkSave} loading={larkLoading} text="推送给飞书 Webhook" />}
        </>
      )}
    </div>
  )
}
