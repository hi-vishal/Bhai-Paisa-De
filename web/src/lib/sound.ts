// Every sound here is synthesized with Web Audio: no files, nothing to download, ~0 KB.

const KEY = 'bpd.sound'
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
})()

let ctx: AudioContext | null = null
let out: GainNode | null = null

function ac() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    ctx = new AC()
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -12
    comp.ratio.value = 4
    out = ctx.createGain()
    out.gain.value = 0.55
    out.connect(comp).connect(ctx.destination)
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

type ToneOpts = {
  f: number
  to?: number
  type?: OscillatorType
  dur?: number
  gain?: number
  at?: number
  attack?: number
  vibrato?: number
  lowpass?: number
}

function tone({ f, to, type = 'sine', dur = 0.12, gain = 0.2, at = 0, attack = 0.004, vibrato, lowpass }: ToneOpts) {
  const c = ac()
  const t0 = c.currentTime + at
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(f, t0)
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  let node: AudioNode = o
  if (lowpass) {
    const lp = c.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = lowpass
    node = node.connect(lp)
  }
  if (vibrato) {
    const lfo = c.createOscillator()
    const lg = c.createGain()
    lfo.frequency.value = 6
    lg.gain.value = vibrato
    lfo.connect(lg).connect(o.frequency)
    lfo.start(t0)
    lfo.stop(t0 + dur)
  }
  node.connect(g).connect(out!)
  o.start(t0)
  o.stop(t0 + dur + 0.02)
}

let noiseBuf: AudioBuffer | null = null
type NoiseOpts = { dur?: number; gain?: number; at?: number; type?: BiquadFilterType; freq?: number; to?: number; q?: number }
function noise({ dur = 0.1, gain = 0.2, at = 0, type = 'highpass', freq = 2000, to, q = 0.7 }: NoiseOpts) {
  const c = ac()
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  const t0 = c.currentTime + at
  const src = c.createBufferSource()
  src.buffer = noiseBuf
  const flt = c.createBiquadFilter()
  flt.type = type
  flt.Q.value = q
  flt.frequency.setValueAtTime(freq, t0)
  if (to) flt.frequency.exponentialRampToValueAtTime(to, t0 + dur)
  const g = c.createGain()
  g.gain.setValueAtTime(gain, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(flt).connect(g).connect(out!)
  src.start(t0, Math.random() * 0.5)
  src.stop(t0 + dur + 0.02)
}

/** struck metal: a few inharmonic partials with long tails */
function bell(f: number, at = 0, gain = 0.12, dur = 1.1) {
  ;[1, 2.76, 5.4, 8.93].forEach((m, i) => tone({ f: f * m, type: 'sine', dur: dur / (1 + i * 0.6), gain: gain / (1 + i * 1.4), at, attack: 0.002 }))
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760]

const play = (fn: () => void) => () => {
  if (!enabled) return
  try {
    fn()
  } catch {
    // audio is a nicety; never let it break a tap
  }
}

export const sfx = {
  tap: play(() => tone({ f: 1500, to: 950, dur: 0.045, gain: 0.08 })),
  press: play(() => {
    tone({ f: 240, to: 110, type: 'triangle', dur: 0.07, gain: 0.22 })
    noise({ dur: 0.025, gain: 0.05, freq: 3500 })
  }),
  key: (d: number) =>
    play(() => {
      const f = PENTA[((d % 10) + 10) % 10]
      tone({ f, dur: 0.22, gain: 0.16 })
      tone({ f: f * 4, dur: 0.05, gain: 0.03 })
    })(),
  backspace: play(() => tone({ f: 320, to: 170, type: 'square', dur: 0.07, gain: 0.04, lowpass: 1600 })),
  pop: play(() => tone({ f: 280, to: 980, dur: 0.09, gain: 0.18 })),
  unpop: play(() => tone({ f: 900, to: 260, dur: 0.1, gain: 0.14 })),
  whoosh: play(() => noise({ dur: 0.28, gain: 0.12, type: 'bandpass', freq: 380, to: 2600, q: 1.2 })),
  toggleOn: play(() => {
    tone({ f: 660, dur: 0.06, gain: 0.12 })
    tone({ f: 990, dur: 0.09, gain: 0.12, at: 0.06 })
  }),
  toggleOff: play(() => {
    tone({ f: 990, dur: 0.06, gain: 0.1 })
    tone({ f: 560, dur: 0.09, gain: 0.1, at: 0.06 })
  }),
  zap: play(() => {
    tone({ f: 2200, to: 70, type: 'sawtooth', dur: 0.32, gain: 0.09, lowpass: 5000 })
    ;[0, 0.04, 0.1, 0.17].forEach((at) => noise({ at, dur: 0.035, gain: 0.12, freq: 4000 }))
  }),
  chaching: play(() => {
    noise({ dur: 0.05, gain: 0.25, freq: 1800 })
    tone({ f: 170, type: 'square', dur: 0.05, gain: 0.08, lowpass: 900 })
    noise({ at: 0.07, dur: 0.04, gain: 0.18, freq: 2500 })
    bell(1975.5, 0.1, 0.14)
    bell(2637, 0.16, 0.12)
  }),
  success: play(() => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone({ f, type: 'triangle', dur: i === 3 ? 0.5 : 0.14, gain: 0.14, at: i * 0.075 }))),
  error: play(() => {
    tone({ f: 155, type: 'square', dur: 0.1, gain: 0.07, lowpass: 900 })
    tone({ f: 140, type: 'square', dur: 0.14, gain: 0.07, lowpass: 900, at: 0.13 })
  }),
  stamp: play(() => {
    tone({ f: 140, to: 42, dur: 0.3, gain: 0.5 })
    noise({ dur: 0.09, gain: 0.3, type: 'lowpass', freq: 900 })
  }),
  tick: play(() => tone({ f: 1900, dur: 0.03, gain: 0.07 })),
  sad: play(() => {
    ;[392, 370, 349.2].forEach((f, i) => tone({ f, type: 'sawtooth', dur: 0.36, gain: 0.07, at: i * 0.4, lowpass: 1400 }))
    tone({ f: 329.6, to: 300, type: 'sawtooth', dur: 1.1, gain: 0.07, at: 1.2, lowpass: 1400, vibrato: 7 })
  }),
  spice: (level: number) =>
    play(() => {
      tone({ f: 330 + level * 140, dur: 0.08, gain: 0.12, type: level > 2 ? 'square' : 'sine', lowpass: 2600 })
      if (level >= 4) tone({ f: 70, to: 45, type: 'sawtooth', dur: 0.4, gain: 0.12, lowpass: 400 })
    })(),
  drumroll: play(() => {
    for (let i = 0; i < 22; i++) noise({ at: i * 0.045, dur: 0.04, gain: 0.04 + i * 0.006, type: 'bandpass', freq: 220, q: 2 })
    noise({ at: 1.0, dur: 1.2, gain: 0.22, freq: 5000 })
    tone({ f: 90, to: 50, at: 1.0, dur: 0.4, gain: 0.35 })
  }),
  send: play(() => {
    tone({ f: 500, to: 1400, dur: 0.12, gain: 0.12 })
    noise({ at: 0.02, dur: 0.18, gain: 0.07, type: 'bandpass', freq: 1200, to: 4000 })
  }),
}

export const sound = {
  get on() {
    return enabled
  },
  set(v: boolean) {
    enabled = v
    try {
      localStorage.setItem(KEY, v ? '1' : '0')
    } catch {
      // private mode: fine, it just won't stick
    }
  },
}

export function haptic(pattern: number | number[] = 8) {
  try {
    if (enabled) navigator.vibrate?.(pattern)
  } catch {
    // iOS has no vibrate; that's fine
  }
}
