const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3001'

function normalized(value: string): string {
  return value.trim().replace(/\/+$/u, '')
}

export function resolveApiBaseUrl(override?: string): string {
  if (override !== undefined && override.trim() !== '') return normalized(override)
  const configured = document.querySelector<HTMLMetaElement>('meta[name="promax-api-base-url"]')?.content
  return configured === undefined || configured.trim() === ''
    ? DEFAULT_API_BASE_URL
    : normalized(configured)
}

