import { getRequestContext } from 'next/server'
import type { RootContext } from './request'
import Link from 'next/link'

export default async function HomePage() {
  const ctx = await getRequestContext<RootContext>()

  return (
    <div>
      <h1>Home</h1>
      <p data-testid="root-value">{ctx.rootValue}</p>
      <p data-testid="pathname">{ctx.pathname}</p>
      <Link href="/se">Go to SE market</Link>
    </div>
  )
}
