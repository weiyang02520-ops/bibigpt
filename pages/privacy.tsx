import Link from 'next/link'

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-12 text-slate-700 dark:text-slate-300">
      <h1 className="text-3xl font-semibold text-slate-950 dark:text-white">隐私说明</h1>

      <div className="mt-8 space-y-6 leading-7">
        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">API 配置</h2>
          <p className="mt-2">
            你在首页填写的 API Key、Base URL 和模型 ID 保存在当前浏览器的
            localStorage。总结时，浏览器将配置发送到本部署的 API；本部署再将字幕和请求转发到你填写的模型服务。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">视频与字幕</h2>
          <p className="mt-2">
            本部署会向哔哩哔哩或 YouTube
            请求视频标题和已有字幕，不下载视频文件。没有可用字幕时不会调用模型，也不会使用视频简介冒充字幕。
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">可选缓存</h2>
          <p className="mt-2">
            只有在部署者配置 Upstash Redis 时，生成结果才会写入共享缓存。当前浏览器中的 API Key 不会写入该缓存。
          </p>
        </section>
      </div>

      <Link
        href="/"
        className="mt-10 inline-flex min-h-10 items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold transition hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800"
      >
        返回首页
      </Link>
    </main>
  )
}
