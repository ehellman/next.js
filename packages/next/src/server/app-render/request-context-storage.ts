import { AsyncLocalStorage } from 'async_hooks'
import type { RequestContextStore } from '../request/request-context'

/**
 * AsyncLocalStorage instance for request context.
 * This allows any code running during a request to access the context.
 */
export const requestContextStorage =
  new AsyncLocalStorage<RequestContextStore>()

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
