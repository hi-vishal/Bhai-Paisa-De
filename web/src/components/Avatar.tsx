import { useState } from 'react'
import { faceFor } from '../lib/avatar'

const SHAPES = [
  'M50 6C76 6 94 22 94 50S76 94 50 94 6 78 6 50 24 6 50 6Z',
  'M30 6H70C84 6 94 16 94 30V70C94 84 84 94 70 94H30C16 94 6 84 6 70V30C6 16 16 6 30 6Z',
  'M50 4L62 14 78 12 84 28 96 40 90 56 96 72 80 80 72 94 56 90 40 96 30 82 14 78 14 62 4 50 12 36 10 20 26 16 36 6Z',
]

function Eyes({ v }: { v: number }) {
  switch (v) {
    case 0:
      return (
        <>
          <circle cx="36" cy="44" r="6" />
          <circle cx="64" cy="44" r="6" />
        </>
      )
    case 1:
      return (
        <g fill="none" stroke="#000" strokeWidth="5" strokeLinecap="round">
          <path d="M29 46q7-8 14 0" />
          <path d="M57 46q7-8 14 0" />
        </g>
      )
    case 2:
      return (
        <>
          <circle cx="36" cy="44" r="9" fill="#fff" stroke="#000" strokeWidth="4" />
          <circle cx="64" cy="44" r="9" fill="#fff" stroke="#000" strokeWidth="4" />
          <circle cx="38" cy="45" r="4" />
          <circle cx="66" cy="45" r="4" />
        </>
      )
    case 3:
      return (
        <g stroke="#000" strokeWidth="5" strokeLinecap="round">
          <path d="M29 44h14" />
          <path d="M57 44h14" />
        </g>
      )
    default:
      return (
        <>
          <rect x="24" y="36" width="24" height="14" rx="4" />
          <rect x="52" y="36" width="24" height="14" rx="4" />
          <path d="M48 41h4" stroke="#000" strokeWidth="4" />
        </>
      )
  }
}

function Mouth({ v }: { v: number }) {
  const p = { fill: 'none', stroke: '#000', strokeWidth: 5, strokeLinecap: 'round' as const }
  switch (v) {
    case 0:
      return <path d="M36 64q14 12 28 0" {...p} />
    case 1:
      return <path d="M40 68h20" {...p} />
    case 2:
      return <ellipse cx="50" cy="68" rx="7" ry="8" fill="#000" />
    case 3:
      return <path d="M36 66q7-6 14 0t14 0" {...p} />
    default:
      return (
        <>
          <path d="M34 62q16 18 32 0Z" fill="#000" />
          <path d="M44 70q6 4 12 0" fill="#FF3D8B" />
        </>
      )
  }
}

/** A real photo when the person added one, otherwise their sticker face (same name, same face, everywhere). */
export function Avatar({ name, src, size = 40, ghost, ring }: { name: string; src?: string | null; size?: number; ghost?: boolean; ring?: string }) {
  const f = faceFor(name)
  const [broken, setBroken] = useState(false)
  if (src && !broken)
    return (
      <span className="avatar avatar--photo" style={{ width: size, height: size, ['--tilt' as string]: `${f.tilt / 2}deg` }} title={name}>
        <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      </span>
    )
  return (
    <span className={`avatar${ghost ? ' avatar--ghost' : ''}`} style={{ width: size, height: size, ['--tilt' as string]: `${f.tilt}deg` }} title={name}>
      <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden>
        <path d={SHAPES[f.shape]} fill={ghost ? '#fff' : f.color} stroke={ring ?? '#000'} strokeWidth={ghost ? 5 : 6} strokeDasharray={ghost ? '9 7' : undefined} strokeLinejoin="round" />
        <g opacity={ghost ? 0.55 : 1}>
          <Eyes v={f.eyes} />
          <Mouth v={f.mouth} />
        </g>
      </svg>
    </span>
  )
}

export function AvatarStack({ names, size = 28, max = 5 }: { names: { name: string; joined?: boolean; avatar?: string | null }[]; size?: number; max?: number }) {
  const shown = names.slice(0, max)
  return (
    <span className="avatar-stack">
      {shown.map((n, i) => (
        <span key={n.name + i} style={{ marginLeft: i ? -size * 0.32 : 0, zIndex: max - i }}>
          <Avatar name={n.name} src={n.avatar} size={size} ghost={n.joined === false} />
        </span>
      ))}
      {names.length > max && <span className="avatar-stack__more">+{names.length - max}</span>}
    </span>
  )
}
