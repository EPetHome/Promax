import { builtinModules } from 'node:module'
import type { UserConfig } from 'tsdown'

const browserExternals = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
])

export function clientPlugin(packageId: string): UserConfig[] {
  return [
    {
      name: `${packageId}:node`,
      entry: ['src/index.ts'],
      outDir: 'lib',
      format: ['esm'],
      platform: 'node',
      target: 'es2022',
      dts: true,
      clean: true,
      deps: {
        neverBundle: specifier => builtinModules.includes(specifier) || specifier.startsWith('node:') || browserExternals.has(specifier),
        alwaysBundle: specifier => !builtinModules.includes(specifier) && !specifier.startsWith('node:') && !browserExternals.has(specifier),
        dts: {
          alwaysBundle: specifier => specifier === '@promax/contracts',
        },
      },
    },
    {
      name: `${packageId}:client`,
      entry: { client: 'src/client/index.tsx' },
      outDir: 'lib',
      format: ['cjs'],
      platform: 'browser',
      target: 'es2022',
      dts: false,
      clean: false,
      deps: {
        neverBundle: specifier => browserExternals.has(specifier),
        alwaysBundle: specifier => !browserExternals.has(specifier),
      },
      outputOptions: {
        entryFileNames: 'client.js',
        banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(packageId)}, factory: (require) => {`,
        footer: 'return module.exports; } });',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
      },
    },
  ]
}
