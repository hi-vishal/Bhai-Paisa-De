// Shrink a photo on the phone before it goes anywhere: a 12 MP camera shot becomes a few hundred KB.
// The server re-encodes it again; this just keeps uploads quick on mobile data.

export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('not an image'))
    }
    img.src = url
  })
}

const toBlob = (c: HTMLCanvasElement, quality = 0.88) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/jpeg', quality))

/** Square crop: `zoom` ≥ 1, `x`/`y` in -1…1 pan the crop window across the spare room. */
export async function cropSquare(img: HTMLImageElement, out: number, zoom = 1, x = 0, y = 0) {
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom
  const sx = (img.naturalWidth - side) / 2 + (x * (img.naturalWidth - side)) / 2
  const sy = (img.naturalHeight - side) / 2 + (y * (img.naturalHeight - side)) / 2
  const c = document.createElement('canvas')
  c.width = c.height = out
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, side, side, 0, 0, out, out)
  return toBlob(c)
}

/** Fit inside `max` px on the long side, for receipts. */
export async function shrink(file: Blob, max = 2000) {
  const img = await loadImage(file)
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.round(img.naturalWidth * k)
  c.height = Math.round(img.naturalHeight * k)
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
  URL.revokeObjectURL(img.src)
  return toBlob(c, 0.85)
}
