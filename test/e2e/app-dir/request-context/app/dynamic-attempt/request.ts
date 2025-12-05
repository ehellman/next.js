import { headers } from 'next/headers'
import type { RequestContextInput } from 'next/server'

export async function onRequest({ params }: RequestContextInput) {
  // This should throw!
  const h = await headers()
  return { headerValue: h.get('x-test') }
}
