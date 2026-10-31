import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

// Match Vite's React deduplication for components imported from shared/.
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier.startsWith('react/')) {
    return nextResolve(pathToFileURL(require.resolve(specifier)).href, context);
  }
  return nextResolve(specifier, context);
}

// Component tests exercise behavior without loading browser styles in Node.
export function load(url, context, nextLoad) {
  if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
  return nextLoad(url, context);
}
