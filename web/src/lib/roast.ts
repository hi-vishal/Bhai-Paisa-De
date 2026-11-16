import type { Lang } from './i18n'

export const ROAST_LEVELS = [
  { emoji: '😇', en: 'Saint', hi: 'Sanskaari' },
  { emoji: '🙂', en: 'Chill', hi: 'Chill' },
  { emoji: '🙃', en: 'Passive-aggressive', hi: 'Taunt mode' },
  { emoji: '😤', en: 'Spicy', hi: 'Teekha' },
  { emoji: '💀', en: 'Nuclear', hi: 'Nuclear' },
] as const

type Vars = { name: string; amt: string; what: string; link: string }

const LINES: Record<Lang, string[][]> = {
  hi: [
    [
      'Hey {name} 🙏 {what} ka hisaab: tera share {amt} hai. Jab time mile, yahan se de dena: {link}',
      '{name}, koi jaldi nahi 🌸 {what} ke {amt} pending hain. Link ye raha: {link}',
    ],
    [
      'Oye {name}! {what} ka {amt} baaki hai 😄 Ek tap, UPI se: {link}',
      '{name} bhai, {what} wala {amt} bhej de na ✌️ {link}',
    ],
    [
      '{name}, koi pressure nahi. Bas {amt} ke saath roz sota hoon, roz jaagta hoon 🙂 {link}',
      'Arre {name}, {what} yaad hai? Main bhoolna chahta hoon. {amt} de de, dono bhool jaayenge 🙃 {link}',
    ],
    [
      '{name} bhai PAISE DE. {amt}. {what}. Link neeche, bahane upar 👆 {link}',
      '{name}, {amt} se itna attachment? Chhod de usse. Yahan: {link} 😤',
    ],
    [
      '🚨 {name} ALERT 🚨 {amt} ({what}) abhi tak pending. Mummy ko bata doon? Sharma ji ka beta time pe deta hai. {link} 💀',
      '{name}, tere {amt} ke chakkar mein maine apni kidney OLX pe daal di hai. Please. {link} 💀',
    ],
  ],
  en: [
    [
      'Hi {name} 🙏 your share for {what} is {amt}. Whenever you get a sec: {link}',
      'Hey {name}, no rush 🌸 {amt} from {what} is still open. Here: {link}',
    ],
    [
      'Hey {name}! {amt} for {what} 😄 one tap and your UPI app opens: {link}',
      '{name}! {what} = {amt}. Easy peasy: {link} ✌️',
    ],
    [
      "{name}, no pressure. I just think about my {amt} every night before bed 🙂 {link}",
      'Hey {name}, remember {what}? I do. Every day. {amt} 🙃 {link}',
    ],
    [
      '{name}. {amt}. {what}. You know what to do. {link} 😤',
      "{name}, the {amt} isn't going to pay itself. Shocking, I know. {link} 😤",
    ],
    [
      "🚨 {name} 🚨 {amt} from {what} is still out there. I've started telling people you're emotionally unavailable with money. Fix it: {link} 💀",
      "{name}, it's giving 'forgot my wallet' energy. {amt}. Now. {link} 💀",
    ],
  ],
}

export function roastLine(level: number, variant: number, lang: Lang, v: Vars) {
  const pool = LINES[lang][Math.max(0, Math.min(4, level))]
  const tpl = pool[variant % pool.length]
  return tpl.replace(/\{(\w+)\}/g, (_, k: keyof Vars) => v[k] ?? '')
}
