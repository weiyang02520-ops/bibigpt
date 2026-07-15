import Image from 'next/image'
import React from 'react'

export function SubmitButton({ loading, label = '一键总结' }: { loading: boolean; label?: string }) {
  if (!loading) {
    return (
      <button
        className="z-10 mx-auto mt-7 w-3/4 rounded-md bg-slate-900 p-3 text-lg font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white sm:mt-10 sm:w-1/3"
        type="submit"
      >
        {label}
      </button>
    )
  }

  return (
    <button
      className="z-10 mx-auto mt-7 w-3/4 cursor-not-allowed rounded-md bg-slate-700 p-3 text-lg font-semibold sm:mt-10 sm:w-1/3"
      disabled
    >
      <div className="flex items-center justify-center text-white">
        <Image src="/loading.svg" alt="Loading..." width={28} height={28} />
      </div>
    </button>
  )
}
