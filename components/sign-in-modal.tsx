import { useSupabaseClient } from '@supabase/auth-helpers-react'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import Image from 'next/image'
import Link from 'next/link'
import React, { Dispatch, SetStateAction, useCallback, useMemo, useState } from 'react'
import Modal from '~/components/shared/modal'
import { getRedirectURL } from '~/utils/getRedirectUrl'

const SignInModal = ({
  showSignInModal,
  setShowSignInModal,
}: {
  showSignInModal: boolean
  setShowSignInModal: Dispatch<SetStateAction<boolean>>
}) => {
  const supabaseClient = useSupabaseClient()
  const redirectURL = getRedirectURL()

  return (
    <Modal showModal={showSignInModal} setShowModal={setShowSignInModal}>
      <div className="w-full overflow-hidden shadow-xl md:max-w-md md:rounded-lg md:border md:border-gray-200">
        <div className="flex flex-col items-center justify-center space-y-3 border-b border-gray-200 bg-white px-4 py-6 pt-8 text-center md:px-16">
          <Link href="/" aria-label="返回 BibiGPT 首页">
            <Image src="/tv-logo.png" alt="BibiGPT" className="h-10 w-10 rounded-full" width={40} height={40} />
          </Link>
          <h3 className="font-display text-2xl font-bold">登录 BibiGPT</h3>
          <p className="text-sm text-slate-500">登录到当前部署</p>
        </div>

        <div className="flex flex-col space-y-4 bg-gray-50 px-4 py-8 md:px-16">
          <Auth
            supabaseClient={supabaseClient}
            redirectTo={redirectURL}
            localization={{
              variables: {
                sign_up: {
                  social_provider_text: '使用 {{provider}} 注册',
                },
                sign_in: {
                  social_provider_text: '使用 {{provider}} 登录',
                },
              },
            }}
            onlyThirdPartyProviders
            providers={['notion', 'github']}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#F17EB8',
                    brandAccent: '#f88dbf',
                  },
                },
              },
            }}
          />
        </div>
        <p className="pb-6 text-center text-slate-400">
          点击登录或注册，即同意
          <a href="/terms-of-use" target="_blank" className="group underline" aria-label="服务条款">
            服务条款
          </a>
          和
          <Link href="/privacy" target="_blank" className="group underline" aria-label="隐私声明">
            隐私政策
          </Link>
          。
        </p>
      </div>
    </Modal>
  )
}

export function useSignInModal() {
  const [showSignInModal, setShowSignInModal] = useState(false)

  const SignInModalCallback = useCallback(() => {
    return <SignInModal showSignInModal={showSignInModal} setShowSignInModal={setShowSignInModal} />
  }, [showSignInModal, setShowSignInModal])

  return useMemo(
    () => ({ setShowSignInModal, SignInModal: SignInModalCallback }),
    [setShowSignInModal, SignInModalCallback],
  )
}
