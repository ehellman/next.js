import { FileRef, nextTestSetup } from 'e2e-utils'
import path from 'path'

describe('request-context', () => {
  const { next } = nextTestSetup({
    // files: __dirname,
    files: new FileRef(path.join(__dirname, 'fixtures', 'default-template')),
    skipStart: true,
  })

  describe('basic functionality', () => {
    it('should provide context from request.ts', async () => {
      const browser = await next.browser('/')
      const text = await browser
        .elementByCss('[data-testid="root-value"]')
        .text()
      await expect(text).toBe('from-root')
    })
  })

  describe('inheritance', () => {
    it('should inherit from parent request.ts', async () => {
      const browser = await next.browser('/se')
      await expect(
        await browser.elementByCss('[data-testid="root-value"]').text()
      ).toBe('from-root')
      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe(
        'se'
      )
    })
  })

  describe('client navigation', () => {
    it('should have context after soft navigation', async () => {
      const browser = await next.browser('/')

      // Click link to navigate
      await browser.elementByCss('a[href="/se"]').click()
      await browser.waitForElementByCss('[data-testid="market"]')

      // Verify context is available
      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe(
        'se'
      )
      expect(
        await browser.elementByCss('[data-testid="root-value"]').text()
      ).toBe('from-root')
    })

    it('should update context when navigating between dynamic routes', async () => {
      const browser = await next.browser('/se')
      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe(
        'se'
      )

      await browser.elementByCss('a[href="/no"]').click()
      await browser.waitForElementByCss('[data-testid="market"]')

      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe(
        'no'
      )
    })
  })

  describe('error handling', () => {
    it('should throw when headers() is called in request.ts', async () => {
      const res = await next.fetch('/dynamic-attempt')
      expect(res.status).toBe(500)

      const html = await res.text()
      expect(html).toContain('Cannot call headers() inside request.ts')
    })
  })
})
