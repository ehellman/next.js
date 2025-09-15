import { nextTestSetup } from 'e2e-utils'
import { check } from 'next-test-utils'

describe('Link with state prop (Pages Router)', () => {
  const { next } = nextTestSetup({
    files: __dirname,
  })

  it('should pass state through navigation in Pages Router', async () => {
    const browser = await next.browser('/')

    // click link with state
    await browser.elementByCss('#link-with-state').click()

    // wait for navigation and check state is available
    await browser.waitForElementByCss('#state-display')

    await check(
      () => browser.elementByCss('#state-display').text(),
      /"from":"pages-home"/
    )

    await browser.close()
  })

  it('should work with shallow routing and state', async () => {
    const browser = await next.browser('/')

    // click shallow link with state
    await browser.elementByCss('#shallow-link-with-state').click()

    // wait for URL change
    await check(
      () => browser.eval(() => window.location.search),
      '?shallow=true'
    )

    // check state is available
    await check(
      () =>
        browser.eval(() => JSON.stringify(window.history.state?.nextLinkState)),
      /"shallow":true/
    )

    await browser.close()
  })
})
