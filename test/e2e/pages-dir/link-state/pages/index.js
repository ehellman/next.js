import Link from 'next/link'
import { useRouter } from 'next/router'

export default function HomePage() {
  const router = useRouter()

  const handleProgrammaticNav = () => {
    router.push('/dashboard', '/dashboard', {
      state: { source: 'pages-programmatic' },
    })
  }

  return (
    <div>
      <h1>Pages Router Link State Test</h1>

      <Link
        href="/dashboard"
        historyState={{ from: 'pages-home', timestamp: Date.now() }}
        id="link-with-state"
      >
        Go to Dashboard with State
      </Link>

      <br />

      <Link
        href="/?shallow=true"
        shallow
        historyState={{ shallow: true }}
        id="shallow-link-with-state"
      >
        Shallow Route with State
      </Link>

      <br />

      <button onClick={handleProgrammaticNav} id="programmatic-nav">
        Programmatic Navigation with State
      </button>
    </div>
  )
}
