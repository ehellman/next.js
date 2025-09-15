'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

export default function HomePage() {
  const router = useRouter()

  const handleProgrammaticNav = () => {
    router.push('/dashboard', {
      historyState: { source: 'programmatic', timestamp: Date.now() },
    })
  }

  return (
    <div>
      <h1>Link State Test</h1>

      <Link
        href="/dashboard"
        historyState={{ from: 'homepage', timestamp: Date.now() }}
        id="link-with-state"
      >
        Go to Dashboard with State
      </Link>

      <br />

      <Link href="/dashboard" id="link-without-state">
        Go to Dashboard without State
      </Link>

      <br />

      <button onClick={handleProgrammaticNav} id="programmatic-nav">
        Programmatic Navigation with State
      </button>
    </div>
  )
}
