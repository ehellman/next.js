import { useEffect, useState } from 'react'
import Link from 'next/link'

export default function Dashboard() {
  const [state, setState] = useState(null)

  useEffect(() => {
    // access state from history
    setState(window.history.state?.nextLinkState)
  }, [])

  return (
    <div>
      <h1>Dashboard (Pages Router)</h1>

      <div id="state-display">{state ? JSON.stringify(state) : 'null'}</div>

      <br />

      <Link href="/" id="back-home">
        Back to Home
      </Link>
    </div>
  )
}
