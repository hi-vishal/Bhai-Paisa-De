import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

// Both voices live at the call site: T('Add expense', 'Kharcha daal'). No key soup.
export type Lang = 'hi' | 'en'
const KEY = 'bpd.lang'

const initial = (): Lang => {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'en' || v === 'hi') return v
  } catch {
    // ignore
  }
  return 'en'
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void; T: (en: string, hi: string) => string }
const LangCtx = createContext<Ctx>({ lang: 'en', setLang: () => {}, T: (en) => en })

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(initial)
  const setLang = useCallback((l: Lang) => {
    set(l)
    document.documentElement.lang = l === 'hi' ? 'hi-Latn' : 'en'
    try {
      localStorage.setItem(KEY, l)
    } catch {
      // ignore
    }
  }, [])
  const T = useCallback((en: string, hi: string) => (lang === 'en' ? en : hi), [lang])
  return <LangCtx.Provider value={{ lang, setLang, T }}>{children}</LangCtx.Provider>
}

export const useLang = () => useContext(LangCtx)
export const useT = () => useContext(LangCtx).T

/** Server errors arrive in English with a code; the ones people actually hit get a Hinglish voice too. */
const ERR_HI: Record<string, string> = {
  offline: 'Server tak pahunch nahi paa rahe. Net check kar.',
  not_your_call: '', // server message names people; keep it
  nothing_owed: '',
  payee_no_wallet: '',
  bad_upi: 'Ye UPI ID nahi lag rahi. Aisi hoti hai: name@okaxis',
  payee_not_joined: '',
  already_claimed: '',
  too_many_claims: 'Pehle wale abhi confirm nahi hue. Thoda ruk.',
  claim_done: 'Iska jawab pehle hi aa gaya.',
  nudged_recently: 'Abhi abhi yaad dilaya tha. Kuch ghante ruk.',
  not_joined: '',
  link_used: 'Ye login code use ho chuka ya expire ho gaya. Doosre phone pe naya bana.',
  holder_not_joined: '',
  bad_kitty: 'Kitty ka bill kitty wala hi bharta hai.',
  bad_image: 'Ye photo khul nahi rahi. JPG ya PNG try kar.',
  already_in: '',
  no_invite: 'Ye invite ab nahi hai.',
  too_much: '',
  slow_down: 'Bhai thoda ruk. Ek minute baad try kar.',
  bad_invite: 'Ye invite link toota hua ya purana hai.',
  bad_link: 'Ye pay link toota hua ya purana hai.',
  mismatch: '',
  expired: 'Quote expire ho gaya. Naya le.',
  server_error: 'Humari taraf kuch toota. Thodi der mein try kar.',
  group_changed: 'Tere type karte waqt group badal gaya. Phir se try kar.',
  signature_mismatch: 'Group badal gaya tha. Refresh ho gaya, phir se try kar.',
  rate_unavailable: 'Abhi fresh rate nahi mil raha, guess nahi karenge. Ek minute baad try kar.',
  challenge_used: 'Ye sign-in pehle hi use ho chuka. Phir se try kar.',
}

export function errText(e: unknown, lang: Lang) {
  const err = e as { code?: string; message?: string }
  if (lang === 'hi' && err?.code && ERR_HI[err.code]) return ERR_HI[err.code]
  return err?.message ?? (lang === 'hi' ? 'Kuch gadbad ho gayi' : 'Something went wrong')
}
