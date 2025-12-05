# Implementation Plan: Request Context (`request.ts`)

This document provides step-by-step implementation details for adding the `request.ts` file convention to Next.js.

## Prerequisites

- Familiarity with Next.js App Router internals
- Understanding of AsyncLocalStorage
- Access to Next.js development environment

## Phase 1: Core Infrastructure (2-3 days)

### Step 1.1: Create Type Definitions

**Create file**: `packages/next/src/server/request/request-context.ts`

```typescript
/**
 * Input provided to onRequest() in request.ts files.
 */
export interface RequestContextInput {
  /**
   * Route parameters extracted from the URL.
   * e.g., for /[market]/[category], params = { market: 'se', category: 'shoes' }
   */
  params: Record<string, string | string[]>

  /**
   * The pathname of the current request.
   * e.g., '/se/shoes/running'
   */
  pathname: string

  /**
   * Context from parent request.ts files (for inheritance).
   * Only present in nested request.ts files.
   */
  parentContext?: unknown
}

/**
 * Internal store structure for request context.
 */
export interface RequestContextStore<T = unknown> {
  /**
   * Promise that resolves when request.ts execution completes.
   * Components await this to get the context.
   */
  promise: Promise<T>

  /**
   * Cached resolved value for sync access after first await.
   */
  resolved?: T

  /**
   * Current pathname (for debugging/validation).
   */
  pathname: string
}

/**
 * Module tuple type for request.ts (matches other conventions).
 */
export type RequestModuleTuple = [
  () => Promise<{ onRequest?: (input: RequestContextInput) => Promise<unknown> }>,
  string  // file path
]
```

### Step 1.2: Create AsyncLocalStorage Instance

**Create file**: `packages/next/src/server/app-render/request-context-storage.ts`

```typescript
import { AsyncLocalStorage } from 'async_hooks'
import type { RequestContextStore } from '../request/request-context'

/**
 * AsyncLocalStorage instance for request context.
 * This allows any code running during a request to access the context.
 */
export const requestContextStorage = new AsyncLocalStorage<RequestContextStore>()

/**
 * Get the request context.
 *
 * This function returns a promise that resolves when request.ts completes.
 * If called from a server component, it will suspend (Suspense) until ready.
 *
 * @example
 * ```tsx
 * import { getRequestContext } from 'next/server'
 *
 * export async function MyComponent() {
 *   const { channel } = await getRequestContext<{ channel: Channel }>()
 *   return <div>{channel.name}</div>
 * }
 * ```
 *
 * @throws Error if called outside of a request context
 */
export async function getRequestContext<T = unknown>(): Promise<T> {
  const store = requestContextStorage.getStore()

  if (!store) {
    throw new Error(
      `getRequestContext() was called outside of a request context.\n\n` +
      `This can happen if:\n` +
      `  - You're calling it from a client component (it's server-only)\n` +
      `  - You're calling it outside of the render cycle\n` +
      `  - There's no request.ts file in your app\n\n` +
      `Make sure you have a request.ts file that exports an onRequest function.`
    )
  }

  // Fast path: already resolved from a previous call
  if (store.resolved !== undefined) {
    return store.resolved as T
  }

  // Slow path: await the promise and cache the result
  try {
    const data = await store.promise
    store.resolved = data
    return data as T
  } catch (error) {
    // Re-throw with additional context
    throw new Error(
      `Error in request.ts: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/**
 * Check if we're currently inside a request context.
 * Useful for conditional logic or libraries.
 */
export function hasRequestContext(): boolean {
  return requestContextStorage.getStore() !== undefined
}
```

### Step 1.3: Create Instance File (for module sharing)

**Create file**: `packages/next/src/server/app-render/request-context-storage-instance.ts`

```typescript
import { AsyncLocalStorage } from 'async_hooks'
import type { RequestContextStore } from '../request/request-context'

// Singleton instance shared across the module boundary
export const requestContextStorageInstance = new AsyncLocalStorage<RequestContextStore>()
```

Update `request-context-storage.ts` to use the instance:

```typescript
import { requestContextStorageInstance as requestContextStorage } from './request-context-storage-instance'

export { requestContextStorage }
// ... rest of the file
```

### Step 1.4: Export from next/server

**Modify file**: `packages/next/src/server/index.ts`

Add these exports:

```typescript
// Request Context
export { getRequestContext, hasRequestContext } from './app-render/request-context-storage'
export type { RequestContextInput } from './request/request-context'
```

### Step 1.5: Add TypeScript Declarations

**Modify file**: `packages/next/types/index.d.ts`

Add to the `next/server` module declaration:

```typescript
declare module 'next/server' {
  // ... existing declarations

  /**
   * Input provided to the onRequest function in request.ts files.
   */
  export interface RequestContextInput {
    params: Record<string, string | string[]>
    pathname: string
    parentContext?: unknown
  }

  /**
   * Get the request context set by request.ts.
   * This function suspends (via Suspense) until request.ts completes.
   *
   * @template T - The type of your request context
   * @returns Promise that resolves to the request context
   * @throws Error if called outside a request or if no request.ts exists
   */
  export function getRequestContext<T = unknown>(): Promise<T>

  /**
   * Check if currently inside a request context.
   */
  export function hasRequestContext(): boolean
}
```

---

## Phase 2: Build-Time Integration (3-4 days)

### Step 2.1: Add `request` to File Types

**Modify file**: `packages/next/src/build/webpack/loaders/next-app-loader/index.ts`

Find `FILE_TYPES` constant and add `request`:

```typescript
const FILE_TYPES = {
  layout: 'layout',
  template: 'template',
  error: 'error',
  loading: 'loading',
  'global-error': 'global-error',
  'global-not-found': 'global-not-found',
  request: 'request',  // ADD THIS LINE
  ...HTTP_ACCESS_FALLBACKS,
} as const
```

### Step 2.2: Update AppDirModules Type

**Modify file**: `packages/next/src/build/webpack/loaders/next-app-loader/index.ts`

Find the `AppDirModules` type definition and add `request`:

```typescript
export type AppDirModules = {
  layout?: ModuleTuple
  template?: ModuleTuple
  error?: ModuleTuple
  loading?: ModuleTuple
  'not-found'?: ModuleTuple
  forbidden?: ModuleTuple
  unauthorized?: ModuleTuple
  'global-error'?: ModuleTuple
  'global-not-found'?: ModuleTuple
  request?: ModuleTuple  // ADD THIS LINE
  page?: ModuleTuple
  defaultPage?: ModuleTuple
}
```

### Step 2.3: Include request.ts in File Discovery

**Modify file**: `packages/next/src/build/webpack/loaders/next-app-loader/index.ts`

In the file discovery logic (likely in a function that iterates over directory contents), ensure `request` files are discovered:

```typescript
// Find the section that discovers files like layout, page, etc.
// Add request to the list of files to discover

const conventionFiles = [
  'layout',
  'template',
  'error',
  'loading',
  'not-found',
  'forbidden',
  'unauthorized',
  'request',  // ADD THIS
  // ... etc
]
```

### Step 2.4: Generate Loader Tree Entry

Ensure the generated loader tree includes the `request` module. Look for where other modules like `layout` are added to the tree and add similar handling for `request`.

The generated code should produce something like:

```javascript
// Generated loader tree structure
[
  'segment',
  { children: /* ... */ },
  {
    layout: [() => import('./layout'), './layout.tsx'],
    request: [() => import('./request'), './request.ts'],  // ADD THIS
    // ... other modules
  }
]
```

---

## Phase 3: Runtime Integration (5-6 days)

### Step 3.1: Create Request Context Execution Logic

**Create file**: `packages/next/src/server/app-render/execute-request-context.ts`

```typescript
import type { LoaderTree } from '../lib/app-dir-module'
import type {
  RequestContextInput,
  RequestModuleTuple,
} from '../request/request-context'
import { workUnitAsyncStorage } from './work-unit-async-storage.external'

/**
 * Collect all request.ts modules from the loader tree, from root to leaf.
 */
function collectRequestModules(tree: LoaderTree): Array<RequestModuleTuple | undefined> {
  const modules: Array<RequestModuleTuple | undefined> = []

  let current: LoaderTree | undefined = tree
  while (current) {
    const [segment, parallelRoutes, mods] = current

    // Add the request module from this level (may be undefined)
    modules.push(mods.request as RequestModuleTuple | undefined)

    // Follow the 'children' parallel route (main route)
    current = parallelRoutes.children
  }

  return modules
}

/**
 * Execute a function in a context where dynamic APIs throw.
 * This ensures request.ts cannot accidentally make routes dynamic.
 */
async function executeInStaticOnlyContext<T>(fn: () => Promise<T>): Promise<T> {
  const workUnitStore = workUnitAsyncStorage.getStore()

  if (!workUnitStore) {
    // No work unit store, just execute
    return fn()
  }

  // Set flag to disallow dynamic APIs
  const originalFlag = workUnitStore.disallowDynamicInRequestContext
  workUnitStore.disallowDynamicInRequestContext = true

  try {
    return await fn()
  } finally {
    // Restore original value
    workUnitStore.disallowDynamicInRequestContext = originalFlag
  }
}

/**
 * Start executing the request context chain.
 *
 * IMPORTANT: This returns a Promise but does NOT await it.
 * This allows component rendering to start immediately.
 * Components that need the context will suspend when they call getRequestContext().
 */
export function startRequestContextExecution(
  loaderTree: LoaderTree,
  input: Omit<RequestContextInput, 'parentContext'>
): Promise<unknown> {
  const requestModules = collectRequestModules(loaderTree)

  // Check if there are any request modules
  const hasRequestModules = requestModules.some(mod => mod !== undefined)
  if (!hasRequestModules) {
    // No request.ts files, resolve with empty object immediately
    return Promise.resolve({})
  }

  // Execute the chain asynchronously
  return (async () => {
    let context: unknown = {}

    for (const requestModule of requestModules) {
      if (requestModule) {
        // Load the module
        const mod = await requestModule[0]()

        // Check for onRequest export
        if (typeof mod.onRequest === 'function') {
          // Execute in static-only context (headers/cookies throw)
          context = await executeInStaticOnlyContext(() =>
            mod.onRequest!({
              params: input.params,
              pathname: input.pathname,
              parentContext: context,
            })
          )
        }
      }
    }

    return context
  })()
}
```

### Step 3.2: Add Flag to Work Unit Store

**Modify file**: `packages/next/src/server/app-render/work-unit-async-storage.external.ts`

Add the flag to the store type:

```typescript
export interface WorkUnitStore {
  // ... existing fields

  /**
   * When true, calls to headers()/cookies() will throw.
   * Used during request.ts execution to enforce static-only access.
   */
  disallowDynamicInRequestContext?: boolean
}
```

### Step 3.3: Enforce Static-Only in headers()/cookies()

**Modify file**: `packages/next/src/server/request/headers.ts` (or similar)

Add check at the start of the `headers()` function:

```typescript
import { workUnitAsyncStorage } from '../app-render/work-unit-async-storage.external'

export async function headers(): Promise<ReadonlyHeaders> {
  const workUnitStore = workUnitAsyncStorage.getStore()

  // Check if we're in request.ts (static-only context)
  if (workUnitStore?.disallowDynamicInRequestContext) {
    throw new Error(
      `Cannot call headers() inside request.ts.\n\n` +
      `request.ts must only use static inputs (params, pathname) to ensure ` +
      `routes can be statically generated.\n\n` +
      `For dynamic data based on headers, either:\n` +
      `  - Use middleware to process headers and pass data via rewrites/cookies\n` +
      `  - Read headers directly in the component that needs them\n`
    )
  }

  // ... rest of existing implementation
}
```

Do the same for `cookies()`:

**Modify file**: `packages/next/src/server/request/cookies.ts` (or similar)

```typescript
import { workUnitAsyncStorage } from '../app-render/work-unit-async-storage.external'

export async function cookies(): Promise<ReadonlyRequestCookies> {
  const workUnitStore = workUnitAsyncStorage.getStore()

  if (workUnitStore?.disallowDynamicInRequestContext) {
    throw new Error(
      `Cannot call cookies() inside request.ts.\n\n` +
      `request.ts must only use static inputs (params, pathname) to ensure ` +
      `routes can be statically generated.\n\n` +
      `For dynamic data based on cookies, either:\n` +
      `  - Use middleware to process cookies and pass data via rewrites\n` +
      `  - Read cookies directly in the component that needs them\n`
    )
  }

  // ... rest of existing implementation
}
```

### Step 3.4: Integrate into renderToHTMLOrFlightImpl

**Modify file**: `packages/next/src/server/app-render/app-render.tsx`

Find `renderToHTMLOrFlightImpl` function (around line 1794) and add request context setup:

```typescript
import { requestContextStorage } from './request-context-storage'
import { startRequestContextExecution } from './execute-request-context'
import type { RequestContextStore } from '../request/request-context'

async function renderToHTMLOrFlightImpl(
  req: BaseNextRequest,
  res: BaseNextResponse,
  url: ReturnType<typeof parseRelativeUrl>,
  pagePath: string,
  query: NextParsedUrlQuery,
  renderOpts: RenderOpts,
  workStore: WorkStore,
  parsedRequestHeaders: ParsedRequestHeaders,
  postponedState: PostponedState | null,
  serverComponentsHmrCache: ServerComponentsHmrCache | undefined,
  sharedContext: AppSharedContext,
  interpolatedParams: Params,
  fallbackRouteParams: OpaqueFallbackRouteParams | null
) {
  // ... existing setup code (keep as-is until we need to wrap rendering)

  const {
    ComponentMod,
    // ... other destructured values
  } = renderOpts

  // Get the loader tree
  const loaderTree = ComponentMod.routeModule.userland.loaderTree

  // Start request context execution (NON-BLOCKING - returns promise, doesn't await)
  const requestContextPromise = startRequestContextExecution(
    loaderTree,
    {
      params: interpolatedParams,
      pathname: url.pathname,
    }
  )

  // Create the store
  const requestContextStore: RequestContextStore = {
    promise: requestContextPromise,
    pathname: url.pathname,
  }

  // Wrap ALL remaining logic in requestContextStorage.run()
  return requestContextStorage.run(requestContextStore, async () => {
    // ... ALL existing rendering logic goes here
    // This includes createComponentTree, renderToStream, etc.
  })
}
```

### Step 3.5: Integrate into generateDynamicRSCPayload

**Modify file**: `packages/next/src/server/app-render/app-render.tsx`

Find `generateDynamicRSCPayload` function (around line 451) and add similar integration:

```typescript
async function generateDynamicRSCPayload(
  ctx: AppRenderContext,
  options?: {
    actionResult?: ActionResult
    skipPageRendering?: boolean
    runtimePrefetchSentinel?: number
  }
): Promise<RSCPayload> {
  const {
    componentMod: {
      routeModule: {
        userland: { loaderTree },
      },
    },
    url,
    getDynamicParamFromSegment,
  } = ctx

  // Extract params from the current context
  // Note: For RSC requests, params need to be extracted from the flight router state
  // or reconstructed from the URL
  const params = extractParamsFromLoaderTree(loaderTree, getDynamicParamFromSegment)

  // Start request context execution (NON-BLOCKING)
  const requestContextPromise = startRequestContextExecution(
    loaderTree,
    {
      params,
      pathname: url.pathname,
    }
  )

  const requestContextStore: RequestContextStore = {
    promise: requestContextPromise,
    pathname: url.pathname,
  }

  // Wrap RSC payload generation in request context
  return requestContextStorage.run(requestContextStore, async () => {
    // ... existing walkTreeWithFlightRouterState logic
    let flightData: FlightData = ''
    // ... rest of existing function body
  })
}

/**
 * Helper to extract params from loader tree for RSC requests.
 */
function extractParamsFromLoaderTree(
  loaderTree: LoaderTree,
  getDynamicParamFromSegment: GetDynamicParamFromSegment
): Record<string, string | string[]> {
  const params: Record<string, string | string[]> = {}

  let current: LoaderTree | undefined = loaderTree
  while (current) {
    const [segment, parallelRoutes] = current

    // Extract dynamic param from segment if present
    const param = getDynamicParamFromSegment(segment)
    if (param && param.value !== null) {
      params[param.param] = param.value
    }

    current = parallelRoutes.children
  }

  return params
}
```

---

## Phase 4: Testing (4-5 days)

### Step 4.1: Create Test Directory Structure

```
test/e2e/app-dir/request-context/
├── app/
│   ├── request.ts
│   ├── layout.tsx
│   ├── page.tsx
│   ├── [market]/
│   │   ├── request.ts
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── product/
│   │       ├── [id]/
│   │       │   └── page.tsx
│   │       └── page.tsx
│   ├── async-context/
│   │   ├── request.ts
│   │   └── page.tsx
│   ├── no-context/
│   │   └── page.tsx
│   ├── error-context/
│   │   ├── request.ts
│   │   └── page.tsx
│   └── dynamic-attempt/
│       ├── request.ts
│       └── page.tsx
├── next.config.js
└── request-context.test.ts
```

### Step 4.2: Create Test Files

**app/request.ts**:
```typescript
import type { RequestContextInput } from 'next/server'

export async function onRequest({ params, pathname }: RequestContextInput) {
  return {
    rootValue: 'from-root',
    pathname,
    timestamp: Date.now(),
  }
}

export type RootContext = Awaited<ReturnType<typeof onRequest>>
```

**app/[market]/request.ts**:
```typescript
import type { RequestContextInput } from 'next/server'
import { getRequestContext } from 'next/server'
import type { RootContext } from '../request'

export async function onRequest({ params }: RequestContextInput) {
  const parent = await getRequestContext<RootContext>()

  return {
    ...parent,
    market: params.market,
    marketSpecific: `market-${params.market}`,
  }
}

export type MarketContext = Awaited<ReturnType<typeof onRequest>>
```

**app/page.tsx**:
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

**app/[market]/page.tsx**:
```typescript
import { getRequestContext } from 'next/server'
import type { MarketContext } from './request'
import Link from 'next/link'

export default async function MarketPage() {
  const ctx = await getRequestContext<MarketContext>()

  return (
    <div>
      <h1>Market: {ctx.market}</h1>
      <p data-testid="root-value">{ctx.rootValue}</p>
      <p data-testid="market">{ctx.market}</p>
      <p data-testid="market-specific">{ctx.marketSpecific}</p>
      <Link href="/se/product">Go to products</Link>
      <Link href="/no">Go to NO market</Link>
    </div>
  )
}
```

**app/dynamic-attempt/request.ts**:
```typescript
import { headers } from 'next/headers'
import type { RequestContextInput } from 'next/server'

export async function onRequest({ params }: RequestContextInput) {
  // This should throw an error
  const h = await headers()
  return { header: h.get('x-test') }
}
```

### Step 4.3: Create Test File

**request-context.test.ts**:
```typescript
import { nextTestSetup } from 'e2e-utils'

describe('request-context', () => {
  const { next } = nextTestSetup({
    files: __dirname,
  })

  describe('basic functionality', () => {
    it('should provide context from request.ts', async () => {
      const browser = await next.browser('/')
      expect(await browser.elementByCss('[data-testid="root-value"]').text())
        .toBe('from-root')
    })

    it('should provide pathname in context', async () => {
      const browser = await next.browser('/')
      expect(await browser.elementByCss('[data-testid="pathname"]').text())
        .toBe('/')
    })
  })

  describe('inheritance', () => {
    it('should inherit from parent request.ts', async () => {
      const browser = await next.browser('/se')
      expect(await browser.elementByCss('[data-testid="root-value"]').text())
        .toBe('from-root')
      expect(await browser.elementByCss('[data-testid="market"]').text())
        .toBe('se')
    })

    it('should have market-specific data', async () => {
      const browser = await next.browser('/se')
      expect(await browser.elementByCss('[data-testid="market-specific"]').text())
        .toBe('market-se')
    })
  })

  describe('client navigation', () => {
    it('should have context after soft navigation', async () => {
      const browser = await next.browser('/')

      // Navigate to market page
      await browser.elementByCss('a[href="/se"]').click()
      await browser.waitForElementByCss('[data-testid="market"]')

      expect(await browser.elementByCss('[data-testid="market"]').text())
        .toBe('se')
      expect(await browser.elementByCss('[data-testid="root-value"]').text())
        .toBe('from-root')
    })

    it('should update context when navigating between markets', async () => {
      const browser = await next.browser('/se')

      expect(await browser.elementByCss('[data-testid="market"]').text())
        .toBe('se')

      // Navigate to different market
      await browser.elementByCss('a[href="/no"]').click()
      await browser.waitForElementByCss('[data-testid="market"]')

      expect(await browser.elementByCss('[data-testid="market"]').text())
        .toBe('no')
    })
  })

  describe('static generation', () => {
    it('should allow static generation when using only params', async () => {
      // Check that the page can be statically generated
      const html = await next.render('/se')
      expect(html).toContain('market-se')
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

  describe('no context', () => {
    it('should throw helpful error when getRequestContext called without request.ts', async () => {
      // This test depends on having a route without any request.ts ancestors
      // and a component that calls getRequestContext
      const res = await next.fetch('/no-context')
      expect(res.status).toBe(500)
    })
  })
})
```

---

## Phase 5: Documentation (2-3 days)

### Step 5.1: API Reference Documentation

Create documentation for:
- `request.ts` file convention
- `onRequest()` function
- `getRequestContext()` function
- `RequestContextInput` type

### Step 5.2: Guide Documentation

Create a guide covering:
- When to use `request.ts` vs middleware vs layouts
- Migration from prop drilling
- Inheritance patterns
- Performance considerations
- Common recipes

---

## Checklist

### Phase 1: Core Infrastructure
- [ ] Create `request-context.ts` type definitions
- [ ] Create `request-context-storage.ts` with AsyncLocalStorage
- [ ] Create instance file for module sharing
- [ ] Export from `next/server`
- [ ] Add TypeScript declarations

### Phase 2: Build-Time Integration
- [ ] Add `request` to `FILE_TYPES`
- [ ] Update `AppDirModules` type
- [ ] Add file discovery for `request.ts`
- [ ] Generate loader tree entries for request modules

### Phase 3: Runtime Integration
- [ ] Create `execute-request-context.ts`
- [ ] Add `disallowDynamicInRequestContext` flag to work unit store
- [ ] Add checks to `headers()` and `cookies()`
- [ ] Integrate into `renderToHTMLOrFlightImpl`
- [ ] Integrate into `generateDynamicRSCPayload`
- [ ] Handle param extraction for RSC requests

### Phase 4: Testing
- [ ] Create test directory structure
- [ ] Write test files (request.ts, pages, etc.)
- [ ] Write e2e tests
- [ ] Test static generation
- [ ] Test client navigation
- [ ] Test error cases

### Phase 5: Documentation
- [ ] API reference
- [ ] Usage guide
- [ ] Migration guide
