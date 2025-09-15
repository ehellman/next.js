/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render } from '@testing-library/react'
import Link from 'next/link'

describe('Link state prop', () => {
  it('should accept state prop without errors', () => {
    const state = { from: 'home', timestamp: Date.now() }

    expect(() => {
      render(
        <Link href="/dashboard" historyState={state}>
          Dashboard
        </Link>
      )
    }).not.toThrow()
  })

  it('should work without state prop (backward compatibility)', () => {
    expect(() => {
      render(<Link href="/dashboard">Dashboard</Link>)
    }).not.toThrow()
  })
})
