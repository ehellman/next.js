# Request Context Implementation - Agent Guide

You are implementing a new Next.js feature: the `request.ts` file convention.

**Read these files first:**
1. `REQUEST_CONTEXT_RFC.md` - Understand the feature design and motivation
2. `REQUEST_CONTEXT_IMPLEMENTATION_PLAN.md` - Step-by-step implementation details

## IMPORTANT: Ask Questions When Uncertain

**If you encounter any of the following, STOP and ask the user before proceeding:**

1. **Architectural uncertainty** - If you're unsure about the right approach or there are multiple valid solutions
2. **Missing information** - If the RFC or implementation plan doesn't cover something you need to know
3. **Unexpected code patterns** - If the existing Next.js code doesn't match what you expected
4. **Test failures you can't diagnose** - If tests fail and you can't determine why after 2-3 attempts
5. **Breaking changes** - If your implementation might break existing functionality
6. **Performance concerns** - If you think the implementation might have performance issues

**It's better to ask and clarify than to make assumptions and build the wrong thing.**

Example questions you might ask:
- "The RFC mentions X but the code has Y. Should I follow the RFC or adapt to the existing pattern?"
- "I found two places where this could be integrated. Which makes more sense: A or B?"
- "The test is failing with error X. I've tried Y and Z. Any ideas?"

---

## Your Mission

Implement the `request.ts` file convention that allows Next.js users to set up request-scoped context that's available in all server components, including during client navigations (RSC requests).

## Critical Success Factors

### 1. Test-First Development

**Before writing any implementation code, create failing tests that demonstrate the problem and expected behavior.**

Create the test directory and files FIRST:
```bash
# Create the test structure
mkdir -p test/e2e/app-dir/request-context/app
mkdir -p test/e2e/app-dir/request-context/app/\[market\]
mkdir -p test/e2e/app-dir/request-context/app/\[market\]/product
mkdir -p test/e2e/app-dir/request-context/app/async-context
mkdir -p test/e2e/app-dir/request-context/app/dynamic-attempt
```

The tests should verify:
1. `getRequestContext()` returns data from `request.ts`
2. Nested `request.ts` files inherit from parent
3. Context is available after client navigation (soft nav)
4. Routes remain static when only using params
5. `headers()`/`cookies()` throw inside `request.ts`

### 2. Verification Loop

**After every significant change, run verification commands.**

#### Build Verification
```bash
# Build the project (required before tests)
pnpm build

# If only changing TypeScript in packages/next/src:
pnpm dev  # Run in background, watches for changes
```

#### Type Checking
```bash
# Generate and check types
pnpm types

# Check specific package types
cd packages/next && pnpm tsc --noEmit
```

#### Run Your Specific Tests
```bash
# Run your test suite in development mode
pnpm test-dev test/e2e/app-dir/request-context/

# Run in production mode
pnpm test-start test/e2e/app-dir/request-context/

# Debug a specific test (opens browser)
pnpm testonly-dev test/e2e/app-dir/request-context/
```

#### Lint Check
```bash
# Run linting
pnpm lint
```

### 3. Implementation Order

Follow this exact order:

#### Phase 0: Create Failing Tests (DO THIS FIRST)
1. Create test directory structure
2. Create test app files (request.ts, pages, layouts)
3. Create test file with test cases
4. Run tests - they should fail (feature doesn't exist yet)
5. Commit: "test: add failing tests for request.ts convention"

#### Phase 1: Core Infrastructure
1. Create type definitions (`packages/next/src/server/request/request-context.ts`)
2. Create storage (`packages/next/src/server/app-render/request-context-storage.ts`)
3. Export from `next/server` (see exact locations below)
4. Run: `pnpm types` - should pass
5. Commit: "feat: add request context types and storage"

#### Phase 2: Build-Time Integration
1. Add `request` to `FILE_TYPES` in next-app-loader
2. Update `AppDirModules` type
3. Add file discovery for `request.ts`
4. Run: `pnpm build` - should pass
5. Commit: "feat: discover request.ts files in app directory"

#### Phase 3: Runtime Integration
1. Create `execute-request-context.ts`
2. Add flag to work unit store
3. Integrate into `renderToHTMLOrFlightImpl`
4. Integrate into `generateDynamicRSCPayload`
5. Add checks to `headers()` and `cookies()`
6. Run tests: `pnpm test-dev test/e2e/app-dir/request-context/`
7. Commit: "feat: execute request.ts and provide getRequestContext()"

#### Phase 4: Make Tests Pass
1. Debug any failing tests
2. Fix issues found
3. Run full test suite
4. Commit: "fix: resolve request context test failures"

---

## Exact File Locations and Line Numbers

### Files to CREATE (new files):

| File | Purpose |
|------|---------|
| `packages/next/src/server/request/request-context.ts` | Type definitions |
| `packages/next/src/server/app-render/request-context-storage.ts` | AsyncLocalStorage + getRequestContext |
| `packages/next/src/server/app-render/execute-request-context.ts` | Execution logic |

### Files to MODIFY (with exact locations):

#### 1. Build-Time: Add `request` to file types
**File:** `packages/next/src/build/webpack/loaders/next-app-loader/index.ts`

- **Line 77:** `FILE_TYPES` constant - Add `request: 'request'` to this object
- **Line 111:** `AppDirModules` type - Add `request?: ModuleTuple` to this type

Look at how `layout`, `template`, `loading` are defined and follow the same pattern.

#### 2. Runtime: Main render function
**File:** `packages/next/src/server/app-render/app-render.tsx`

- **Line 451:** `generateDynamicRSCPayload` - This handles RSC requests (client navigation). Wrap the function body in `requestContextStorage.run()`
- **Line 1794:** `renderToHTMLOrFlightImpl` - This handles full page renders. Wrap the rendering logic in `requestContextStorage.run()`

Both functions need to:
1. Call `startRequestContextExecution()` (returns a promise, don't await)
2. Create a `RequestContextStore` with the promise
3. Wrap remaining logic in `requestContextStorage.run(store, () => { ... })`

#### 3. Runtime: Add flag to work unit store
**File:** `packages/next/src/server/app-render/work-unit-async-storage.external.ts`

- **Line 26:** `CommonWorkUnitStore` interface - Add `disallowDynamicInRequestContext?: boolean`

#### 4. Runtime: Make headers() throw in request.ts
**File:** `packages/next/src/server/request/headers.ts`

- **Line 40:** `headers()` function - Add check at the start:
```typescript
const workUnitStore = workUnitAsyncStorage.getStore()
if (workUnitStore?.disallowDynamicInRequestContext) {
  throw new Error('Cannot call headers() inside request.ts...')
}
```

#### 5. Runtime: Make cookies() throw in request.ts
**File:** `packages/next/src/server/request/cookies.ts`

- **Line 33:** `cookies()` function - Add same check as headers()

#### 6. Export from next/server
**File:** `packages/next/server.js`

Add to the `serverExports` object (around line 1-16):
```javascript
getRequestContext: require('next/dist/server/app-render/request-context-storage').getRequestContext,
```

And add the named export at the bottom:
```javascript
exports.getRequestContext = serverExports.getRequestContext
```

**File:** `packages/next/server.d.ts`

Add type export (after line 22):
```typescript
export { getRequestContext } from 'next/dist/server/app-render/request-context-storage'
export type { RequestContextInput } from 'next/dist/server/request/request-context'
```

---

## Key Files Overview

```
packages/next/
├── server.js                           # MODIFY: Add getRequestContext export (line ~14)
├── server.d.ts                         # MODIFY: Add type export (line ~22)
└── src/
    ├── server/
    │   ├── request/
    │   │   ├── request-context.ts      # NEW: Type definitions
    │   │   ├── headers.ts              # MODIFY: Add throw check (line 40)
    │   │   └── cookies.ts              # MODIFY: Add throw check (line 33)
    │   └── app-render/
    │       ├── request-context-storage.ts   # NEW: AsyncLocalStorage + getRequestContext
    │       ├── execute-request-context.ts   # NEW: Execution logic
    │       ├── app-render.tsx               # MODIFY: Integrate (lines 451, 1794)
    │       └── work-unit-async-storage.external.ts  # MODIFY: Add flag (line 26)
    └── build/
        └── webpack/
            └── loaders/
                └── next-app-loader/
                    └── index.ts             # MODIFY: FILE_TYPES (line 77), AppDirModules (line 111)
```

---

### 5. Debugging Tips

#### If tests fail with "module not found":
- Run `pnpm build` to rebuild
- Check exports in `packages/next/server.js` and `packages/next/server.d.ts`

#### If types are wrong:
- Run `pnpm types` to regenerate
- Check `packages/next/server.d.ts`

#### If request context is undefined:
- Check that `requestContextStorage.run()` wraps the rendering
- Verify the promise is stored, not awaited
- Check that both `renderToHTMLOrFlightImpl` AND `generateDynamicRSCPayload` are wrapped

#### If static generation breaks:
- Ensure `executeInStaticOnlyContext` is working
- Check that `headers()`/`cookies()` throw when flag is set

#### To debug a test with browser visible:
```bash
pnpm testonly-dev test/e2e/app-dir/request-context/
```

#### To keep test files after failure:
```bash
NEXT_TEST_SKIP_CLEANUP=1 pnpm test-dev test/e2e/app-dir/request-context/
```

---

### 6. Test File Templates

#### test/e2e/app-dir/request-context/app/request.ts
```typescript
import type { RequestContextInput } from 'next/server'

export async function onRequest({ params, pathname }: RequestContextInput) {
  return {
    rootValue: 'from-root',
    pathname,
  }
}

export type RootContext = Awaited<ReturnType<typeof onRequest>>
```

#### test/e2e/app-dir/request-context/app/page.tsx
```typescript
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
```

#### test/e2e/app-dir/request-context/app/[market]/request.ts
```typescript
import type { RequestContextInput } from 'next/server'
import { getRequestContext } from 'next/server'
import type { RootContext } from '../request'

export async function onRequest({ params }: RequestContextInput) {
  const parent = await getRequestContext<RootContext>()

  return {
    ...parent,
    market: params.market as string,
  }
}

export type MarketContext = Awaited<ReturnType<typeof onRequest>>
```

#### test/e2e/app-dir/request-context/app/[market]/page.tsx
```typescript
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
```

#### test/e2e/app-dir/request-context/app/[market]/layout.tsx
```typescript
export default function MarketLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

#### test/e2e/app-dir/request-context/app/dynamic-attempt/request.ts
```typescript
import { headers } from 'next/headers'
import type { RequestContextInput } from 'next/server'

export async function onRequest({ params }: RequestContextInput) {
  // This should throw!
  const h = await headers()
  return { headerValue: h.get('x-test') }
}
```

#### test/e2e/app-dir/request-context/app/dynamic-attempt/page.tsx
```typescript
export default function DynamicAttemptPage() {
  return <div>This should not render</div>
}
```

#### test/e2e/app-dir/request-context/request-context.test.ts
```typescript
import { nextTestSetup } from 'e2e-utils'

describe('request-context', () => {
  const { next, isNextDev } = nextTestSetup({
    files: __dirname,
  })

  describe('basic functionality', () => {
    it('should provide context from request.ts', async () => {
      const browser = await next.browser('/')
      const text = await browser.elementByCss('[data-testid="root-value"]').text()
      expect(text).toBe('from-root')
    })
  })

  describe('inheritance', () => {
    it('should inherit from parent request.ts', async () => {
      const browser = await next.browser('/se')
      expect(await browser.elementByCss('[data-testid="root-value"]').text()).toBe('from-root')
      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe('se')
    })
  })

  describe('client navigation', () => {
    it('should have context after soft navigation', async () => {
      const browser = await next.browser('/')

      // Click link to navigate
      await browser.elementByCss('a[href="/se"]').click()
      await browser.waitForElementByCss('[data-testid="market"]')

      // Verify context is available
      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe('se')
      expect(await browser.elementByCss('[data-testid="root-value"]').text()).toBe('from-root')
    })

    it('should update context when navigating between dynamic routes', async () => {
      const browser = await next.browser('/se')
      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe('se')

      await browser.elementByCss('a[href="/no"]').click()
      await browser.waitForElementByCss('[data-testid="market"]')

      expect(await browser.elementByCss('[data-testid="market"]').text()).toBe('no')
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
```

#### test/e2e/app-dir/request-context/app/layout.tsx
```typescript
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
```

#### test/e2e/app-dir/request-context/next.config.js
```javascript
/** @type {import('next').NextConfig} */
module.exports = {}
```

---

### 7. Commit Strategy

Make small, focused commits:
1. `test: add failing tests for request.ts convention`
2. `feat: add request context types and storage`
3. `feat: discover request.ts files in app directory`
4. `feat: execute request.ts and provide getRequestContext()`
5. `test: verify all request context tests pass`

---

### 8. When Stuck

1. **Read the existing code** - Look at how `layout.ts` or `loading.ts` are handled in `next-app-loader/index.ts`
2. **Check similar patterns** - Search for `workAsyncStorage.run` or `AsyncLocalStorage` in `app-render.tsx`
3. **Run with debug output** - Add `console.log` statements and check server output
4. **Isolate the problem** - Create minimal reproduction in test
5. **ASK THE USER** - If you've tried 2-3 approaches and still stuck, ask for help!

---

### 9. Definition of Done

- [ ] All tests in `test/e2e/app-dir/request-context/` pass
- [ ] `pnpm build` succeeds
- [ ] `pnpm types` succeeds
- [ ] `pnpm lint` succeeds (or only has pre-existing issues)
- [ ] Feature works in both dev (`next dev`) and prod (`next build && next start`)
- [ ] Client navigation (soft nav) correctly executes `request.ts`
- [ ] `headers()`/`cookies()` throw clear error when called in `request.ts`
- [ ] Static routes remain static when `request.ts` only uses params

---

## Quick Reference Commands

```bash
# Setup
pnpm install
pnpm build

# Development
pnpm dev                                    # Watch mode for packages/next

# Testing
pnpm test-dev test/e2e/app-dir/request-context/   # Run tests in dev mode
pnpm test-start test/e2e/app-dir/request-context/ # Run tests in prod mode
pnpm testonly-dev test/e2e/app-dir/request-context/ # Debug with browser

# Verification
pnpm types                                  # Generate type definitions
pnpm lint                                   # Run linter
pnpm build                                  # Full build

# Debugging
NEXT_TEST_SKIP_CLEANUP=1 pnpm test-dev ...  # Keep test files after run
```

---

**Remember: Ask questions when uncertain. It's better to clarify than to assume!**

Good luck! Start with Phase 0 (create failing tests), then work through each phase methodically.
