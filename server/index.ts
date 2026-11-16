import cluster from 'node:cluster'
import { config } from './config'

// One process per core, all serving HTTP on the same port and sharing one SQLite file (WAL mode).
// Exactly one of them, the "jobs" worker, also publishes the ledger and watches for payments.
// If any worker dies it is replaced; if the jobs worker dies, its replacement takes over the jobs.
// Production always runs under this supervisor, even with one worker, so a crash means a restart.

if (cluster.isPrimary && (config.workers > 1 || config.prod)) {
  // everything a worker would otherwise race to create happens here, once, before any fork:
  // secrets (importing config made them), the schema, and the push keys
  const { migrate } = await import('./db')
  migrate()
  ;(await import('./push')).vapidKeys()
  const roles = new Map<number, boolean>()
  let stopping = false
  const fork = (jobs: boolean) => {
    const w = cluster.fork({ BPD_JOBS: jobs ? '1' : '0' })
    roles.set(w.id, jobs)
  }
  fork(true)
  for (let i = 1; i < config.workers; i++) fork(false)
  cluster.on('exit', (w, code, signal) => {
    const jobs = roles.get(w.id) ?? false
    roles.delete(w.id)
    if (stopping) return
    console.warn(`[primary] worker ${w.process.pid} exited (${signal ?? code}); starting a new one${jobs ? ' to run jobs' : ''}`)
    setTimeout(() => fork(jobs), 1000)
  })
  const stop = () => {
    stopping = true
    for (const w of Object.values(cluster.workers ?? {})) w?.process.kill('SIGTERM')
    setTimeout(() => process.exit(0), 12_000).unref()
    cluster.on('exit', () => Object.keys(cluster.workers ?? {}).length === 0 && process.exit(0))
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
} else {
  const { start } = await import('./app')
  start({ jobs: cluster.isPrimary || process.env.BPD_JOBS === '1' })
}
