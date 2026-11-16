// Runs before first paint so a dark-mode phone never flashes the light notebook.
;(function () {
  try {
    var t = localStorage.getItem('bpd.theme')
    var dark = t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    var m = document.querySelector('meta[name="theme-color"]')
    if (m) m.setAttribute('content', dark ? '#14101D' : '#EFE9FF')
  } catch (e) {}
})()
