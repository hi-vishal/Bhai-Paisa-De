import { useCallback, useEffect, useRef, useState } from 'react'

// Tiny stale-while-revalidate: show what we had instantly, refresh behind it.
const cache = new Map<string, unknown>()
const listeners = new Map<string, Set<(v: unknown) => void>>()

export function setCached<T>(key: string, value: T) {
  cache.set(key, value)
  listeners.get(key)?.forEach((fn) => fn(value))
}

export function useResource<T>(key: string | null, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => (key ? (cache.get(key) as T | undefined) : undefined))
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(!data)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  const reload = useCallback(async () => {
    if (!key) return
    setLoading(true)
    try {
      const v = await fetchRef.current()
      setCached(key, v)
      setError(null)
      return v
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [key])

  useEffect(() => {
    if (!key) return
    setData(cache.get(key) as T | undefined)
    const fn = (v: unknown) => setData(v as T)
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key)!.add(fn)
    void reload()
    return () => void listeners.get(key)?.delete(fn)
  }, [key, reload])

  const mutate = useCallback((v: T) => key && setCached(key, v), [key])
  return { data, error, loading, reload, mutate }
}
