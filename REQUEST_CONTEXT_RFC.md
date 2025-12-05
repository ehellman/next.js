# RFC: Request Context Convention (`request.ts`)

## Summary

Introduce a new file convention `request.ts` (or `request.js`) that runs on **every request** - including RSC/Flight requests for client navigations - before any component rendering begins. This enables request-scoped context that doesn't require prop drilling and doesn't force dynamic rendering.

## Motivation

### The Problem

Currently, there's no way to run code "above" the root layout that executes on every request, including partial RSC renders during client navigation.

**Why this matters:**

1. **Layouts don't re-render on soft navigation** - When navigating between `/market/se/page-a` and `/market/se/page-b`, the `RootLayout` is not re-executed because Next.js optimizes by only rendering changed segments.

2. **`React.cache()` is render-scoped** - Data stored via `React.cache()` in a layout isn't available during RSC requests that skip that layout.

3. **`headers()`/`cookies()` force dynamic rendering** - Reading request headers opts the entire route into dynamic rendering, breaking static generation and ISR.

4. **Prop drilling is the only alternative** - Currently, to make route-derived data available everywhere, you must pass it as props through every component layer.

### Use Cases

| Use Case                    | Current Workaround       | Problem with Workaround                 |
| --------------------------- | ------------------------ | --------------------------------------- |
| Multi-market/channel config | Prop drill from layout   | Doesn't work on client nav; verbose     |
| Feature flags (route-based) | Read headers             | Forces dynamic rendering                |
| Tenant configuration        | Prop drill or headers    | Same as above                           |
| Request-scoped telemetry    | Middleware + headers     | Forces dynamic; spans don't flow to RSC |
| i18n/locale setup           | Prop drill from layout   | Doesn't work on client nav              |
| A/B test bucketing          | Headers/cookies          | Forces dynamic rendering                |
| Database connection routing | Prop drill               | Verbose; error-prone                    |
| Cache key scoping           | Manual in each component | Repetitive; easy to forget              |

### Key Insight

All these use cases share a pattern: **data derived from static inputs (URL, route params) that needs to be globally available during a request**.

This data:

- Is deterministic given the URL
- Doesn't depend on dynamic request data (headers, cookies)
- Should be available in every server component
- Shouldn't force dynamic rendering

### Analogy: .NET Dependency Injection

This is conceptually similar to `AddScoped` in .NET:

```csharp
// .NET - service created once per request, same instance throughout
services.AddScoped<IChannelService, ChannelService>();
```

```typescript
// request.ts - context created once per request, available everywhere
export async function onRequest({ params }) {
  return { channel: await resolveChannel(params.market) }
}
```

## Detailed Design

### File Convention

```
app/
├── request.ts          # Root-level request context
├── [market]/
│   ├── request.ts      # Market-specific context (inherits + extends)
│   └── page.tsx
└── layout.tsx
```

### API

```typescript
// app/request.ts
import type { RequestContextInput } from 'next/server'

export async function onRequest(context: RequestContextInput) {
  // context.params - route parameters (e.g., { market: 'se' })
  // context.pathname - current pathname

  const channel = await resolveChannel(context.params.market)

  return {
    channel,
    locale: channel.locale,
    features: await loadFeatureFlags(channel.id),
  }
}

// Optional: Type the return value for consumers
export type RequestData = Awaited<ReturnType<typeof onRequest>>
```

### Consuming the Context

```typescript
// Any server component, anywhere in the tree
import { getRequestContext } from 'next/server'
import type { RequestData } from '@/app/request'

export async function ProductCard() {
  // This await may suspend the component if request.ts hasn't resolved yet
  // Other components continue rendering in parallel (non-blocking)
  const { channel, locale } = await getRequestContext<RequestData>()

  const product = await fetchProduct(channel.id, productId)

  return <div>{product.name}</div>
}
```

### Inheritance & Composition

Nested `request.ts` files inherit from parent and can extend:

```typescript
// app/[market]/request.ts
import { getRequestContext } from 'next/server'
import type { RequestData as ParentData } from '@/app/request'

export async function onRequest(context: RequestContextInput) {
  const parent = await getRequestContext<ParentData>()

  // Extend with market-specific data
  return {
    ...parent,
    marketConfig: await loadMarketConfig(context.params.market),
  }
}
```

### Non-Blocking Execution (Critical Design Decision)

**`request.ts` execution MUST NOT block component rendering.**

The execution model follows React's streaming/Suspense pattern:

```
Request arrives
    │
    ├──▶ request.ts starts executing (async)
    │         │
    │         │ (promise stored, not awaited)
    │         ▼
    └──▶ Component rendering starts IMMEDIATELY
              │
              ├── ComponentA renders (doesn't need context) ✓
              ├── ComponentB renders (doesn't need context) ✓
              └── ComponentC calls getRequestContext()
                       │
                       ▼
                  Suspends until request.ts resolves
                       │
                       ▼
                  Continues rendering ✓
```

This means:

- Components that don't need request context render immediately
- Components that need it suspend (via the returned promise)
- Other branches of the tree continue rendering in parallel
- Maximum parallelism, minimum blocking

### Static vs Dynamic

**Critical**: `request.ts` enforces static-only inputs. Dynamic APIs throw errors.

| Input          | Allowed   | Notes                                                  |
| -------------- | --------- | ------------------------------------------------------ |
| `params`       | ✅ Yes    | Route params are known at build time for static routes |
| `pathname`     | ✅ Yes    | Deterministic from URL                                 |
| `headers()`    | ❌ Throws | Use middleware for dynamic data                        |
| `cookies()`    | ❌ Throws | Use middleware for dynamic data                        |
| `searchParams` | ❌ No     | Could be added later with careful consideration        |

```typescript
// app/request.ts
import { headers } from 'next/headers'

export async function onRequest({ params }) {
  // ❌ This throws an error:
  // Error: Cannot call headers() inside request.ts.
  // request.ts must only use static inputs (params, pathname).
  // For dynamic data, use middleware or read headers in components.
  const h = await headers()

  // ✅ This is fine:
  const channel = resolveChannel(params.market)
  return { channel }
}
```

This enforcement ensures `request.ts` **cannot interfere** with the static/dynamic rendering system.

### Relationship with Other Next.js Features

```
┌─────────────────────────────────────────────────────────────────┐
│                         REQUEST LIFECYCLE                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Middleware (Edge Runtime)                                   │
│     - CAN access headers, cookies, geo                          │
│     - CAN set headers, rewrite, redirect                        │
│     - Runs before request hits origin                           │
│     - Use for: auth redirects, geo routing, header manipulation │
│                                                                 │
│  2. request.ts (Server, this proposal)                          │
│     - CANNOT access headers, cookies (throws error)             │
│     - CAN access params, pathname                               │
│     - Sets up request-scoped context                            │
│     - Runs before component rendering, non-blocking             │
│     - Does NOT force dynamic rendering                          │
│     - Use for: channel config, feature flags, i18n setup        │
│                                                                 │
│  3. Component Tree (Server)                                     │
│     - Layouts, pages, components render                         │
│     - CAN access getRequestContext() (suspends if needed)       │
│     - CAN access headers/cookies (makes route dynamic)          │
│                                                                 │
│  4. Client Components (Browser)                                 │
│     - Hydration, interactivity                                  │
│     - Cannot access getRequestContext() (server only)           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Core Infrastructure

#### 1.1 Define Types

**File**: `packages/next/src/server/request/request-context.ts` (new)

```typescript
export interface RequestContextInput {
  params: Record<string, string | string[]>
  pathname: string
  parentContext?: unknown
}

export interface RequestContextStore<T = unknown> {
  promise: Promise<T>
  resolved?: T // Cached after resolution for sync access
  pathname: string
}
```

#### 1.2 Create AsyncLocalStorage for Request Context

**File**: `packages/next/src/server/app-render/request-context-storage.ts` (new)

```typescript
import { AsyncLocalStorage } from 'async_hooks'
import type { RequestContextStore } from '../request/request-context'

export const requestContextStorage =
  new AsyncLocalStorage<RequestContextStore>()

/**
 * Get the request context. Returns a promise that resolves when request.ts completes.
 * Components calling this will suspend until the context is available.
 */
export async function getRequestContext<T = unknown>(): Promise<T> {
  const store = requestContextStorage.getStore()
  if (!store) {
    throw new Error(
      'getRequestContext() can only be called during request rendering. ' +
        'Make sure you have a request.ts file in your app directory.'
    )
  }

  // Fast path: already resolved
  if (store.resolved !== undefined) {
    return store.resolved as T
  }

  // Slow path: wait for promise and cache result
  const data = await store.promise
  store.resolved = data
  return data as T
}
```

#### 1.3 Export from `next/server`

**File**: `packages/next/src/server/index.ts` (modify)

```typescript
export { getRequestContext } from './app-render/request-context-storage'
export type { RequestContextInput } from './request/request-context'
```

### Phase 2: Build-Time Integration

#### 2.1 Add `request` to File Types

**File**: `packages/next/src/build/webpack/loaders/next-app-loader/index.ts`

```typescript
const FILE_TYPES = {
  layout: 'layout',
  template: 'template',
  error: 'error',
  loading: 'loading',
  'global-error': 'global-error',
  'global-not-found': 'global-not-found',
  request: 'request', // NEW
  ...HTTP_ACCESS_FALLBACKS,
} as const
```

#### 2.2 Update LoaderTree Type

**File**: `packages/next/src/server/lib/app-dir-module.ts`

Add `request` to the modules interface used in LoaderTree.

#### 2.3 Discover `request.ts` Files

**File**: `packages/next/src/build/webpack/loaders/next-app-loader/index.ts`

In the file discovery logic, include `request.ts`/`request.js` alongside other conventions.

### Phase 3: Runtime Integration

#### 3.1 Implement Request Context Execution

**File**: `packages/next/src/server/app-render/execute-request-context.ts` (new)

```typescript
import type { LoaderTree } from '../lib/app-dir-module'
import type {
  RequestContextInput,
  RequestContextStore,
} from '../request/request-context'
import { requestContextStorage } from './request-context-storage'

/**
 * Collect all request.ts modules from root to the target segment.
 */
function collectRequestModules(
  tree: LoaderTree
): Array<ModuleTuple | undefined> {
  const modules: Array<ModuleTuple | undefined> = []

  let current: LoaderTree | undefined = tree
  while (current) {
    const [, parallelRoutes, mods] = current
    modules.push(mods.request)
    current = parallelRoutes.children
  }

  return modules
}

/**
 * Execute the request context chain. Returns a promise (does not await).
 * This allows rendering to start immediately while request.ts executes.
 */
export function startRequestContextExecution(
  loaderTree: LoaderTree,
  input: Omit<RequestContextInput, 'parentContext'>
): Promise<unknown> {
  const requestModules = collectRequestModules(loaderTree)

  // Execute chain asynchronously
  return (async () => {
    let context: unknown = {}

    for (const requestModule of requestModules) {
      if (requestModule) {
        const mod = await requestModule[0]()
        if (typeof mod.onRequest === 'function') {
          // Run in a restricted context where headers/cookies throw
          context = await executeInStaticContext(() =>
            mod.onRequest({
              ...input,
              parentContext: context,
            })
          )
        }
      }
    }

    return context
  })()
}

/**
 * Execute a function in a context where dynamic APIs (headers, cookies) throw.
 */
async function executeInStaticContext<T>(fn: () => Promise<T>): Promise<T> {
  // Implementation: Set a flag in workUnitAsyncStorage that causes
  // headers()/cookies() to throw when accessed
  // This leverages existing Next.js infrastructure for tracking dynamic access
  return fn() // TODO: Add restriction wrapper
}
```

#### 3.2 Integrate into Full Page Renders

**File**: `packages/next/src/server/app-render/app-render.tsx`

**Location**: Inside `renderToHTMLOrFlightImpl`, near the start.

```typescript
async function renderToHTMLOrFlightImpl() {
  // ... existing params
  // ... existing setup code

  // Start request context execution (non-blocking)
  const requestContextPromise = startRequestContextExecution(loaderTree, {
    params: interpolatedParams,
    pathname: url.pathname,
  })

  // Create the store with the promise (not awaited)
  const requestContextStore: RequestContextStore = {
    promise: requestContextPromise,
    pathname: url.pathname,
  }

  // Wrap all rendering in the request context storage
  return requestContextStorage.run(requestContextStore, async () => {
    // ... existing rendering logic continues IMMEDIATELY
    // Components that need context will suspend on getRequestContext()
  })
}
```

#### 3.3 Integrate into RSC/Flight Requests

**File**: `packages/next/src/server/app-render/app-render.tsx`

**Location**: Inside `generateDynamicRSCPayload` (around line 451).

```typescript
async function generateDynamicRSCPayload(
  ctx: AppRenderContext,
  options?: {
    /* ... */
  }
): Promise<RSCPayload> {
  const {
    componentMod: {
      routeModule: {
        userland: { loaderTree },
      },
    },
    url,
  } = ctx

  // Extract params from the flight router state or URL
  const params = extractParamsFromContext(ctx)

  // Start request context execution (non-blocking)
  const requestContextPromise = startRequestContextExecution(loaderTree, {
    params,
    pathname: url.pathname,
  })

  const requestContextStore: RequestContextStore = {
    promise: requestContextPromise,
    pathname: url.pathname,
  }

  // Wrap RSC generation in the request context storage
  return requestContextStorage.run(requestContextStore, async () => {
    // ... existing walkTreeWithFlightRouterState logic
  })
}
```

#### 3.4 Enforce Static-Only Access

**File**: `packages/next/src/server/app-render/execute-request-context.ts`

Implement `executeInStaticContext` to throw when dynamic APIs are accessed:

```typescript
import { workUnitAsyncStorage } from './work-unit-async-storage.external'

async function executeInStaticContext<T>(fn: () => Promise<T>): Promise<T> {
  const workUnitStore = workUnitAsyncStorage.getStore()

  // Set a flag that headers()/cookies() check
  const originalDisallowDynamic = workUnitStore?.disallowDynamicInRequestContext
  if (workUnitStore) {
    workUnitStore.disallowDynamicInRequestContext = true
  }

  try {
    return await fn()
  } finally {
    if (workUnitStore) {
      workUnitStore.disallowDynamicInRequestContext = originalDisallowDynamic
    }
  }
}
```

Then modify `headers()` and `cookies()` implementations to check this flag:

```typescript
// In headers.ts / cookies.ts
export async function headers() {
  const workUnitStore = workUnitAsyncStorage.getStore()

  if (workUnitStore?.disallowDynamicInRequestContext) {
    throw new Error(
      'Cannot call headers() inside request.ts. ' +
        'request.ts must only use static inputs (params, pathname). ' +
        'For dynamic data, use middleware or read headers in your components.'
    )
  }

  // ... existing implementation
}
```

### Phase 4: TypeScript Support

#### 4.1 Type Declarations

**File**: `packages/next/types/index.d.ts`

```typescript
declare module 'next/server' {
  export interface RequestContextInput {
    params: Record<string, string | string[]>
    pathname: string
    parentContext?: unknown
  }

  export function getRequestContext<T = unknown>(): Promise<T>
}
```

### Phase 5: Testing

#### 5.1 Unit Tests

Location: `packages/next/src/server/app-render/__tests__/`

- `execute-request-context.test.ts`
  - Correctly walks loader tree to collect request modules
  - Executes modules in order (root to leaf)
  - Passes parent context to child modules
  - Throws when headers()/cookies() accessed

- `request-context-storage.test.ts`
  - `getRequestContext()` throws outside request
  - Returns cached value on subsequent calls
  - Properly suspends until promise resolves

#### 5.2 Integration Tests

**Directory**: `test/e2e/app-dir/request-context/`

```
test/e2e/app-dir/request-context/
├── app/
│   ├── request.ts                    # Root: { rootValue: 'root' }
│   ├── layout.tsx
│   ├── page.tsx                      # Displays rootValue
│   ├── [market]/
│   │   ├── request.ts                # Extends: { market: params.market }
│   │   ├── layout.tsx
│   │   ├── page.tsx                  # Displays rootValue + market
│   │   └── product/
│   │       └── page.tsx              # Nested page, tests client nav
│   ├── no-context/
│   │   └── page.tsx                  # Page without request.ts ancestor
│   ├── async-context/
│   │   ├── request.ts                # Async: await fetch(...)
│   │   └── page.tsx
│   ├── error-context/
│   │   ├── request.ts                # Throws error
│   │   └── page.tsx
│   └── dynamic-attempt/
│       ├── request.ts                # Tries to call headers()
│       └── page.tsx
├── request-context.test.ts
└── next.config.js
```

**Test Cases**:

1. **Basic access**: `getRequestContext()` returns data from `request.ts`
2. **Inheritance**: Nested `request.ts` receives parent context
3. **Client navigation**: Context available after soft navigation
4. **Static generation**: Route remains static when only using params
5. **Async context**: Async work in `request.ts` doesn't block other components
6. **Non-blocking**: Components not using context render before `request.ts` completes
7. **Error in request.ts**: Proper error boundary handling
8. **Dynamic API throws**: `headers()` in `request.ts` throws clear error
9. **No context**: `getRequestContext()` outside request throws helpful error

### Phase 6: Documentation

#### 6.1 API Reference

- `request.ts` file convention
- `onRequest()` function signature
- `getRequestContext()` API
- `RequestContextInput` type

#### 6.2 Guide: Request Context Pattern

- When to use `request.ts` vs middleware vs layouts
- Non-blocking execution model explained
- Inheritance patterns
- Performance characteristics
- Migration from prop drilling
- Common patterns and recipes

## Alternative Names Considered

| Name           | Pros                                | Cons                                      |
| -------------- | ----------------------------------- | ----------------------------------------- |
| `request.ts`   | Clear purpose; matches HTTP concept | Might confuse with Request object         |
| `context.ts`   | React-familiar                      | Too generic; conflicts with React Context |
| `bootstrap.ts` | Clear "runs first" semantics        | Not web-specific                          |
| `setup.ts`     | Clear purpose                       | Generic                                   |
| `preload.ts`   | Indicates early execution           | Conflicts with resource preloading        |
| `scope.ts`     | Indicates request scope             | Not intuitive                             |
| `init.ts`      | Clear initialization                | Too generic                               |

**Recommendation**: `request.ts` - it clearly indicates this runs per-request and aligns with web platform terminology.

## Open Questions

1. **How to handle errors in `request.ts`?**
   - Option A: Bubble up to nearest error boundary
   - Option B: Provide fallback value mechanism
   - Recommendation: Option A for simplicity, matches component error handling

2. **Caching behavior for static routes?**
   - Should the resolved context be cached across requests for static routes?
   - Recommendation: Follow normal fetch caching rules - if `request.ts` does cached fetches, they're cached

3. **Client component access?**
   - Should there be a way to pass context data to client components?
   - Recommendation: Not in v1. Users can pass as props or use existing patterns.

4. **Edge runtime support?**
   - Should `request.ts` work in Edge runtime?
   - Recommendation: Yes, but needs verification that AsyncLocalStorage works

## Success Metrics

1. No dynamic rendering bailout when using only static-safe inputs
2. Works correctly on both full renders and RSC requests
3. Non-blocking: components render in parallel with `request.ts` execution
4. Type-safe access via `getRequestContext<T>()`
5. Clear error messages when misused (headers in request.ts, access outside request)
6. Performance: <1ms overhead for simple sync cases

## Timeline Estimate

| Phase                           | Effort   | Dependencies |
| ------------------------------- | -------- | ------------ |
| Phase 1: Core Infrastructure    | 2-3 days | None         |
| Phase 2: Build-Time Integration | 3-4 days | Phase 1      |
| Phase 3: Runtime Integration    | 5-6 days | Phase 1, 2   |
| Phase 4: TypeScript Support     | 1-2 days | Phase 1      |
| Phase 5: Testing                | 4-5 days | Phase 1-4    |
| Phase 6: Documentation          | 2-3 days | Phase 1-5    |

**Total: ~3-4 weeks**

## References

- [Next.js App Router Architecture](https://nextjs.org/docs/app)
- [React Server Components RFC](https://github.com/reactjs/rfcs/blob/main/text/0188-server-components.md)
- [AsyncLocalStorage Documentation](https://nodejs.org/api/async_context.html)
