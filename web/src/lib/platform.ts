const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

/** iPhone or iPad (iPadOS reports itself as a Mac with a touchscreen). Android never counts. */
export const isIOS = () => !/Android/.test(ua()) && (/iPhone|iPad|iPod/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
export const isMobile = () => /Android|iPhone|iPad|iPod/.test(ua()) || isIOS()
