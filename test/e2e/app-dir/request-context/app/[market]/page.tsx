import { getRequestContext } from 'next/server'
import type { MarketContext } from './request'
import Link from 'next/link'

export default async function MarketPage() {
  const ctx = await getRequestContext<MarketContext>()

  return (
    <div>
      <h1>Market Page</h1>
      <p data-testid="root-value">{ctx.rootValue}</p>
      <p data-testid="market">{ctx.market}</p>
      <Link href="/no">Go to NO market</Link>
      <Link href="/">Go home</Link>
    </div>
  )
}
