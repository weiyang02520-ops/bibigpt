import { Poppins } from 'next/font/google'
import clsx from 'clsx'
import Image from 'next/image'
import Link from 'next/link'
import React from 'react'
import SignIn from '~/components/SignIn'
import Github from '../components/GitHub'

const poppins = Poppins({ weight: '800', subsets: ['latin'] })

export default function Header({
  showSingIn,
  authEnabled = true,
}: {
  showSingIn: (show: boolean) => void
  authEnabled?: boolean
}) {
  return (
    <header className="supports-backdrop-blur:bg-white/60 sticky top-0 z-40 w-full flex-none border-b border-slate-900/10 bg-white/95 py-2 backdrop-blur transition-colors duration-500 dark:border-slate-50/[0.08] dark:bg-slate-900/95 lg:z-50 lg:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-3">
        <Link href="/" className="flex min-w-0 items-center gap-3" aria-label="BibiGPT 首页">
          <Image src="/tv-logo.png" alt="BibiGPT" className="h-9 w-9 rounded-full" width={36} height={36} priority />
          <h2 className={clsx('truncate text-lg sm:text-2xl', poppins.className)}>
            BibiGPT
            <span className="ml-2 hidden text-xs font-medium text-slate-500 dark:text-slate-400 sm:inline">
              个人 BYOK
            </span>
          </h2>
        </Link>

        <div className="flex shrink-0 items-center gap-3">
          <a
            href="https://github.com/weiyang02520-ops/bibigpt"
            rel="noreferrer noopener"
            target="_blank"
            className="flex h-9 w-9 items-center justify-center text-slate-600 transition hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-slate-300 dark:hover:text-white"
            aria-label="查看本部署的 GitHub 仓库"
            title="GitHub 仓库"
          >
            <Github width="28" height="28" />
          </a>
          {authEnabled ? <SignIn showSingIn={showSingIn} /> : null}
        </div>
      </div>
    </header>
  )
}
