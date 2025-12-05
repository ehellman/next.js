import type { LoaderTree } from '../lib/app-dir-module'
import type { RequestContextInput } from '../request/request-context'
import { workUnitAsyncStorage } from './work-unit-async-storage.external'

type RequestModule = [() => Promise<any>, string]

/**
 * Collect all request.ts modules from the loader tree, from root to leaf.
 */
function collectRequestModules(
  tree: LoaderTree
): Array<RequestModule | undefined> {
  const modules: Array<RequestModule | undefined> = []

  let current: LoaderTree | undefined = tree
  while (current) {
    const parallelRoutes = current[1] as any
    const mods = current[2]

    // Add the request module from this level (may be undefined)
    modules.push(mods.request as RequestModule | undefined)

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
  const hasRequestModules = requestModules.some((mod) => mod !== undefined)
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
          // eslint-disable-next-line no-loop-func -- context is intentionally captured for inheritance
          context = await executeInStaticOnlyContext(() =>
            mod.onRequest({
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
