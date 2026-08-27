export { PromaxConsole } from './components/PromaxConsole.tsx'
export { PromaxApiClient, PromaxApiError } from './data/api-client.ts'
export { BrowserTokenStore, MemoryTokenStore } from './data/token-store.ts'
export { resolveApiBaseUrl } from './data/config.ts'

/** Host half: browser presentation is exported through `./client`. */
export function apply(): void {}

