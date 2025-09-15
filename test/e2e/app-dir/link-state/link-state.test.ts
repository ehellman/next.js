import { nextTestSetup } from 'e2e-utils'
import { retry } from 'next-test-utils'

describe('Link with state prop', () => {
  const { next } = nextTestSetup({
    files: __dirname,
  })

  it('should pass state through navigation', async () => {
    const browser = await next.browser('/')

    // click link with state
    await browser.elementByCss('#link-with-state').click()

    // wait for navigation and check state is available
    await browser.waitForElementByCss('#state-display')

    await retry(async () => {
      const text = await browser.elementByCss('#state-display').text()
      expect(text).toMatch(/"from":"homepage"/)
    })

    await browser.close()
  })

  it('should preserve state on browser back/forward', async () => {
    const browser = await next.browser('/')

    // navigate with state
    await browser.elementByCss('#link-with-state').click()
    await browser.waitForElementByCss('#state-display')

    // verify initial state
    await retry(async () => {
      const text = await browser.elementByCss('#state-display').text()
      expect(text).toMatch(/"from":"homepage"/)
    })

    // go back then forward
    await browser.back()
    await browser.waitForElementByCss('#link-with-state')
    await browser.forward()
    await browser.waitForElementByCss('#state-display')

    // state should still be there
    await retry(async () => {
      const text = await browser.elementByCss('#state-display').text()
      expect(text).toMatch(/"from":"homepage"/)
    })

    await browser.close()
  })

  it('should work with programmatic navigation', async () => {
    // NOTE: Skipped - waiting for router.push state support
    const browser = await next.browser('/')

    // click button that uses router.push with state
    await browser.elementByCss('#programmatic-nav').click()

    // wait for navigation and check state
    await browser.waitForElementByCss('#state-display')

    await retry(async () => {
      const text = await browser.elementByCss('#state-display').text()
      expect(text).toMatch(/"source":"programmatic"/)
    })

    await browser.close()
  })

  it('should handle navigation without state', async () => {
    const browser = await next.browser('/')

    // click link without state
    await browser.elementByCss('#link-without-state').click()

    // wait for navigation
    await browser.waitForElementByCss('#state-display')

    // state should be null/undefined
    await retry(async () => {
      const text = await browser.elementByCss('#state-display').text()
      expect(text).toMatch(/null|undefined/)
    })

    await browser.close()
  })
})
