import { Eye, EyeOff } from 'lucide-react'
import React, { useState } from 'react'

type UserKeyInputProps = {
  value: string | undefined
  onChange: React.ChangeEventHandler<HTMLInputElement>
  baseUrl: string | undefined
  onBaseUrlChange: React.ChangeEventHandler<HTMLInputElement>
  oauthLoading: boolean
  onStartOpenRouterOAuth: () => void
}

export function UserKeyInput(props: UserKeyInputProps) {
  const [showApiKey, setShowApiKey] = useState(false)

  return (
    <section className="mx-auto mt-10 w-full max-w-3xl" aria-labelledby="model-service-heading">
      <h2 id="model-service-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
        模型服务配置
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
        API Key 仅保存在当前浏览器。浏览器只会把它发送到本部署；本部署再使用它请求你配置的模型服务。
      </p>

      <div className="mt-5 space-y-5">
        <div>
          <label htmlFor="user-api-key" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200">
            API Key
          </label>
          <div className="relative">
            <input
              id="user-api-key"
              type={showApiKey ? 'text' : 'password'}
              value={props.value ?? ''}
              onChange={props.onChange}
              autoComplete="new-password"
              spellCheck={false}
              className="block w-full rounded-md border border-slate-300 bg-transparent py-2 pl-3 pr-11 text-sm leading-6 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-600 dark:text-slate-100"
              placeholder="填写 OpenAI-compatible API Key"
            />
            <button
              type="button"
              onClick={() => setShowApiKey((visible) => !visible)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-slate-500 transition hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:hover:text-slate-100"
              aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
              title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
            >
              {showApiKey ? (
                <EyeOff className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Eye className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <div>
          <label
            htmlFor="user-api-base-url"
            className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-200"
          >
            API Base URL
          </label>
          <input
            id="user-api-base-url"
            type="url"
            value={props.baseUrl ?? ''}
            onChange={props.onBaseUrlChange}
            autoComplete="url"
            spellCheck={false}
            className="block w-full rounded-md border border-slate-300 bg-transparent px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30 dark:border-slate-600 dark:text-slate-100"
            placeholder="https://api.openai.com/v1"
          />
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            填写服务商的 OpenAI-compatible API 根地址。留空时使用本部署的服务端配置，未配置则使用 OpenAI 默认地址。
          </p>
        </div>

        <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
          <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">OpenRouter OAuth（可选）</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                仅在使用 OpenRouter 时选择；授权成功后会自动填写 Key 和 Base URL。
              </p>
            </div>
            <button
              type="button"
              onClick={props.onStartOpenRouterOAuth}
              disabled={props.oauthLoading}
              className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              {props.oauthLoading ? '正在前往 OpenRouter...' : '使用 OpenRouter OAuth'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
