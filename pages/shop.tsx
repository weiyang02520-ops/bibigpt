import Link from 'next/link'

export default function ShopPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100">个人 BYOK 配置</h1>
      <p className="mt-4 leading-7 text-slate-600 dark:text-slate-400">API Key、Base URL 和模型 ID 均在首页配置。</p>
      <Link
        href="/"
        className="mt-8 inline-flex min-h-10 items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        返回首页
      </Link>
    </main>
  )
}
