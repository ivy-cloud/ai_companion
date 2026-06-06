/** Resolve extensionless relative imports to .ts for Node unit tests. */
import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier.startsWith('.') &&
    !extname(specifier) &&
    context.parentURL?.startsWith('file:')
  ) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const tsPath = join(parentDir, `${specifier}.ts`);
    if (existsSync(tsPath)) {
      return {
        url: pathToFileURL(tsPath).href,
        shortCircuit: true,
      };
    }
  }
  return nextResolve(specifier, context);
}
