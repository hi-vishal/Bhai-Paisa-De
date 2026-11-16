// Deterministic sticker-buddy faces from a name. Same name, same face, every device.

export const STICKER_COLORS = ['#FFC21A', '#FF3D8B', '#B8F25B', '#4FD6E8', '#B9A4FF', '#FF8A3D', '#7CF0C3', '#FFB3D9']

export function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function faceFor(name: string) {
  const h = hash(name.trim().toLowerCase() || '?')
  return {
    color: STICKER_COLORS[h % STICKER_COLORS.length],
    eyes: (h >>> 3) % 5,
    mouth: (h >>> 7) % 5,
    tilt: ((h >>> 11) % 13) - 6,
    shape: (h >>> 15) % 3,
  }
}
