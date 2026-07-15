import { buttonVariants } from '@/components/ui/button'
import Link from 'next/link'
import { ModeToggle } from '~/components/mode-toggle'
import { Icons } from './icons'

export default function Footer() {
  return (
    <footer className="z-40 mt-6 flex w-full items-center justify-center border-t border-slate-200 bg-white px-3 py-3 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <div className="flex items-center gap-1">
        <Link
          href="/privacy"
          className="px-3 py-2 text-sm transition hover:text-slate-900 dark:hover:text-slate-100"
          aria-label="隐私声明"
        >
          隐私
        </Link>
        <a
          href="https://github.com/weiyang02520-ops/bibigpt"
          target="_blank"
          rel="noreferrer noopener"
          className={buttonVariants({
            size: 'sm',
            variant: 'ghost',
            className: 'text-slate-700 dark:text-slate-400',
          })}
          aria-label="查看本部署的 GitHub 仓库"
          title="GitHub 仓库"
        >
          <Icons.gitHub className="h-5 w-5" />
          <span className="sr-only">GitHub</span>
        </a>
        <ModeToggle />
      </div>
    </footer>
  )
}
