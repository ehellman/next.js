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
