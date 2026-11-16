// Renders the PWA icons from the logo mark. Run with `npm run icons`.
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const out = resolve(import.meta.dirname, '../web/public/icons')
const mark = readFileSync(resolve(import.meta.dirname, '../web/public/favicon.svg'), 'utf8')
const inner = mark.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')

// full-bleed magenta tile; the mark sits inside the maskable safe zone
const tile = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#FF3D8B"/>
  <g opacity="0.16" stroke="#000" stroke-width="0.8">${Array.from({ length: 12 }, (_, i) => `<path d="M0 ${8 + i * 8}H100"/>`).join('')}</g>
  <g transform="translate(${50 - 50 * scale} ${52 - 50 * scale}) scale(${scale})">${inner}</g>
</svg>`

const jobs = [
  ['icon-192.png', 192, 0.8],
  ['icon-512.png', 512, 0.8],
  ['maskable-512.png', 512, 0.62],
  ['apple-touch-icon.png', 180, 0.74],
]
for (const [name, size, scale] of jobs) await sharp(Buffer.from(tile(scale))).resize(size, size).png().toFile(`${out}/${name}`)
console.log('icons written to', out)

// the picture WhatsApp, iMessage and friends show under a shared link (1200×630)
const og = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#EFE9FF"/>
  <g stroke="#3C1E8C" stroke-opacity="0.08" stroke-width="2">${Array.from({ length: 20 }, (_, i) => `<path d="M0 ${32 + i * 32}H1200"/>`).join('')}</g>
  <path d="M86 0V630" stroke="#FF3D8B" stroke-opacity="0.35" stroke-width="4"/>
  <g transform="translate(150 120) rotate(-3)">
    <rect x="12" y="12" width="560" height="390" rx="40" fill="#000"/>
    <rect width="560" height="390" rx="40" fill="#FFC21A" stroke="#000" stroke-width="8"/>
    <g transform="translate(44 40) scale(1.5)">${inner}</g>
    <text x="44" y="250" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="78" letter-spacing="-3" fill="#000">bhai paise de.</text>
  </g>
  <g transform="translate(770 150) rotate(4)">
    <rect x="8" y="8" width="330" height="120" rx="26" fill="#000"/>
    <rect width="330" height="120" rx="26" fill="#B8F25B" stroke="#000" stroke-width="6"/>
    <text x="30" y="74" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="40" fill="#000">Split bills</text>
  </g>
  <g transform="translate(740 330) rotate(-3)">
    <rect x="8" y="8" width="380" height="120" rx="26" fill="#000"/>
    <rect width="380" height="120" rx="26" fill="#4FD6E8" stroke="#000" stroke-width="6"/>
    <text x="30" y="74" font-family="Helvetica, Arial, sans-serif" font-weight="800" font-size="40" fill="#000">Paid back by UPI</text>
  </g>
</svg>`
await sharp(Buffer.from(og)).png().toFile(resolve(import.meta.dirname, '../web/public/og.png'))
console.log('og.png written')
