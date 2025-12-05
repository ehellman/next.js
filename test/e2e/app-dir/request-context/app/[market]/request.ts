import type { RequestContextInput } from 'next/server'
import { getRequestContext } from 'next/server'
import type { RootContext } from '../request'

export async function onRequest({ params }: RequestContextInput) {
  const parent = await getRequestContext<RootContext>()

  return {
    ...parent,
    market: params.market as string,
  }
}

export type MarketContext = Awaited<ReturnType<typeof onRequest>>
