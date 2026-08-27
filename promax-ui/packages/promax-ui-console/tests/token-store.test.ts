import type { LoginResponse, MeResponse } from '@promax/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_SESSION_EVENT, BrowserTokenStore } from '../src/data/token-store.ts'
import { contractFixture } from './fixtures.ts'

describe('BrowserTokenStore', () => {
  beforeEach(() => window.localStorage.clear())

  it('round-trips contract tokens and the current user', () => {
    const store = new BrowserTokenStore()
    const session = {
      tokens: contractFixture<LoginResponse>('auth.login.response.json'),
      user: contractFixture<MeResponse>('me.response.json'),
    }

    store.write(session)

    expect(store.read()).toEqual(session)
  })

  it('clears malformed persisted data instead of trusting it', () => {
    window.localStorage.setItem('promax.auth.v1', '{"tokens":{"access_token":42}}')
    const store = new BrowserTokenStore()

    expect(store.read()).toBeUndefined()
    expect(window.localStorage.getItem('promax.auth.v1')).toBeNull()
  })

  it('notifies both writes and clears', () => {
    const listener = vi.fn()
    window.addEventListener(AUTH_SESSION_EVENT, listener)
    const store = new BrowserTokenStore()

    store.write({ tokens: contractFixture<LoginResponse>('auth.login.response.json') })
    store.clear()

    expect(listener).toHaveBeenCalledTimes(2)
    window.removeEventListener(AUTH_SESSION_EVENT, listener)
  })
})
