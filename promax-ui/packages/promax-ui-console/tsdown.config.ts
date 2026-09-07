import { clientPlugin } from '../../scripts/client-plugin.ts'

export default [
  ...clientPlugin('@promax/promax-ui-console').map(config => ({
    ...config,
    loader: { '.png': 'dataurl' as const },
  })),
  {
    name: '@promax/promax-ui-console:server',
    entry: { server: 'src/server.ts' },
    outDir: 'lib',
    format: ['esm'] as const,
    platform: 'node' as const,
    target: 'es2022',
    dts: true,
    clean: false,
  },
]
