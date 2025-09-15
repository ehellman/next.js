/* eslint-env jest */
import React from 'react'
import ReactDOM from 'react-dom/server'
import Link from 'next/link'

describe('Link state SSR', () => {
  it('should render Link with state prop during SSR', () => {
    const element = React.createElement(
      Link,
      {
        href: '/dashboard',
        historyState: { from: 'home' },
      },
      'Dashboard'
    )

    const html = ReactDOM.renderToString(element)
    expect(html).toMatchInlineSnapshot(`"<a href="/dashboard">Dashboard</a>"`)
  })

  it('should render Link without state prop during SSR', () => {
    const element = React.createElement(
      Link,
      {
        href: '/about',
      },
      'About'
    )

    const html = ReactDOM.renderToString(element)
    expect(html).toMatchInlineSnapshot(`"<a href="/about">About</a>"`)
  })
})
