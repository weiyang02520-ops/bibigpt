import React from 'react'
import { UseFormReturn } from 'react-hook-form/dist/types/form'
import { PROMPT_LANGUAGE_MAP } from '~/utils/constants/language'

type OpenRouterModelOption = {
  id: string
  name: string
}

export function PromptOptions({
  register,
  getValues,
  modelOptions,
  modelLoading,
  asrModel,
  onAsrModelChange,
}: {
  // TODO: add types
  register: any
  getValues: UseFormReturn['getValues']
  modelOptions: OpenRouterModelOption[]
  modelLoading: boolean
  asrModel: string
  onAsrModelChange: React.ChangeEventHandler<HTMLSelectElement>
}) {
  const shouldShowTimestamp = getValues('showTimestamp')
  return (
    <div className="mt-6 grid grid-cols-2 items-center gap-x-10 gap-y-2 md:mt-10 md:grid-cols-3 md:gap-y-6">
      <div className="col-span-2 md:col-span-3">
        <label htmlFor="model" className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
          模型 ID
        </label>
        <input
          id="model"
          type="text"
          list="openrouter-model-suggestions"
          autoComplete="off"
          spellCheck={false}
          aria-describedby="model-description"
          placeholder="例如：gpt-4.1-mini 或 openai/gpt-4.1-mini"
          className="block w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-sky-500 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-sky-500 dark:focus:ring-sky-500"
          {...register('model')}
        />
        <datalist id="openrouter-model-suggestions">
          {modelOptions.map((model) => (
            <option key={model.id} value={model.id} label={model.name} />
          ))}
        </datalist>
        <p id="model-description" className="mt-2 text-sm text-slate-500 dark:text-slate-400">
          {modelLoading
            ? '正在加载 OpenRouter 模型建议，也可以直接输入模型 ID。'
            : modelOptions.length > 0
            ? '可输入任意 OpenAI-compatible 模型 ID，OpenRouter 建议仅供选择。'
            : '请输入模型服务支持的 OpenAI-compatible 模型 ID。'}
        </p>
      </div>
      <label className="relative inline-flex cursor-pointer items-center">
        <input type="checkbox" className="peer sr-only" {...register('showTimestamp')} />
        <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-sky-400 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-sky-800"></div>
        <span className="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300">是否显示时间戳</span>
      </label>
      <label className="relative inline-flex cursor-pointer items-center">
        <input type="checkbox" className="peer sr-only" {...register('showEmoji')} />
        <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-sky-400 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-sky-300 dark:border-gray-600 dark:bg-gray-700 dark:peer-focus:ring-sky-800"></div>
        <span className="ml-3 text-sm font-medium text-gray-900 dark:text-gray-300">是否显示 Emoji</span>
      </label>
      <div>
        <label htmlFor="outputLanguage" className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
          输出语言
        </label>
        <select
          id="outputLanguage"
          className="block w-full rounded-md border border-gray-300 bg-gray-50 text-sm text-gray-900 focus:border-sky-500 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400 dark:focus:border-sky-500 dark:focus:ring-sky-500"
          {...register('outputLanguage')}
        >
          {Object.keys(PROMPT_LANGUAGE_MAP).map((k: string) => (
            <option key={PROMPT_LANGUAGE_MAP[k]} value={PROMPT_LANGUAGE_MAP[k]}>
              {k}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="asrModel" className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
          无字幕转写
        </label>
        <select
          id="asrModel"
          value={asrModel}
          onChange={onAsrModelChange}
          className="block w-full rounded-md border border-gray-300 bg-gray-50 text-sm text-gray-900 focus:border-sky-500 focus:ring-sky-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="onnx-community/whisper-small">准确</option>
          <option value="onnx-community/whisper-base">快速</option>
        </select>
      </div>

      <div>
        <label htmlFor="sentenceNumber" className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
          要点个数
          <span className="text-gray-500">(≤{getValues('sentenceNumber')})</span>
        </label>
        <input
          id="sentenceNumber"
          type="range"
          min={3}
          max={10}
          step={1}
          className="h-2 w-full cursor-pointer rounded-lg bg-gray-200 accent-black dark:bg-gray-700"
          {...register('sentenceNumber', {
            valueAsNumber: true,
          })}
        />
      </div>
      <div>
        <label htmlFor="outlineLevel" className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
          大纲层级
          <span className="text-gray-500">(≤{getValues('outlineLevel')})</span>
        </label>
        <input
          id="outlineLevel"
          type="range"
          min={1}
          max={5}
          step={1}
          className="h-2 w-full cursor-pointer rounded-lg bg-gray-200 accent-black dark:bg-gray-700"
          disabled={shouldShowTimestamp}
          {...register('outlineLevel', {
            valueAsNumber: true,
          })}
        />
      </div>
      <div>
        <label htmlFor="detailLevel" className="mb-2 block text-sm font-medium text-gray-900 dark:text-white">
          详细程度
          <span className="text-gray-500">(≤{getValues('detailLevel')})</span>
        </label>
        <input
          id="detailLevel"
          type="range"
          min={300}
          max={1000}
          step={10}
          className="h-2 w-full cursor-pointer rounded-lg bg-gray-200 accent-black dark:bg-gray-700"
          {...register('detailLevel', {
            valueAsNumber: true,
          })}
        />
      </div>
    </div>
  )
}
