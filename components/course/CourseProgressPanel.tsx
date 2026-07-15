import { Ban, RotateCcw } from 'lucide-react'
import { CourseJob, CourseProgress } from '~/lib/course/types'

export function CourseProgressPanel({
  job,
  progress,
  running,
  onCancel,
  onResume,
}: {
  job: CourseJob | null
  progress: CourseProgress | null
  running: boolean
  onCancel: () => void
  onResume: () => void
}) {
  if (!progress && !job) {
    return null
  }
  const completed = progress?.completed || 0
  const total = Math.max(progress?.total || 1, 1)
  const percentage = Math.max(0, Math.min(100, Math.round((completed / total) * 100)))
  const canResume = !running && job && job.status !== 'complete'

  return (
    <section className="mx-auto mt-8 w-full max-w-3xl border-t border-slate-200 pt-6 dark:border-slate-700">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            {progress?.label || '课程处理'}
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {progress ? `${Math.round(completed)} / ${Math.round(total)}` : job?.error || ''}
          </p>
        </div>
        {running ? (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-300 text-slate-600 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
            title="取消"
            aria-label="取消课程处理"
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : canResume ? (
          <button
            type="button"
            onClick={onResume}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white transition hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            继续
          </button>
        ) : null}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
        <div className="h-full bg-sky-500 transition-[width] duration-300" style={{ width: `${percentage}%` }} />
      </div>
      {job?.error && !running && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{job.error}</p>}
    </section>
  )
}
