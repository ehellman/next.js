import type { RequestContextInput } from 'next/server'

export async function onRequest({ params, pathname }: RequestContextInput) {
  return {
    rootValue: 'from-root',
    pathname,
  }
}

export type RootContext = Awaited<ReturnType<typeof onRequest>>
