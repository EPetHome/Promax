import { createHash, randomBytes, randomUUID } from 'node:crypto'

import { compare, hash } from 'bcryptjs'
import { jwtVerify, SignJWT } from 'jose'

import type { EmployeeRole } from '@promax/contracts'

import { ApiError } from './errors.ts'
import type { RefreshTokenRepository } from './refresh-token-repository.ts'
import type { UserRecord, UserRepository } from './user-repository.ts'

const ACCESS_TOKEN_ISSUER = 'promax'
const ACCESS_TOKEN_AUDIENCE = 'promax-api'

export interface AuthenticatedUser {
  employeeId: string
  name: string
  dept: string
  role: EmployeeRole
}

export interface IssuedTokens {
  accessToken: string
  refreshToken: string
  expiresIn: number
  refreshExpiresIn: number
}

export class AuthService {
  private readonly encodedSecret: Uint8Array

  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    jwtSecret: string,
    private readonly accessTtlSeconds: number,
    private readonly refreshTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly refreshTokenFactory: () => string = () => `prt_${randomBytes(32).toString('base64url')}`,
    private readonly chainIdFactory: () => string = randomUUID,
  ) {
    this.encodedSecret = new TextEncoder().encode(jwtSecret)
  }

  async login(employeeId: string, password: string): Promise<IssuedTokens> {
    const user = this.users.findByEmployeeId(employeeId)
    if (!user || !await compare(password, user.passwordHash)) {
      throw new ApiError('UNAUTHORIZED', '工号或密码错误')
    }

    const issuedAt = this.now()
    const refreshToken = this.refreshTokenFactory()
    this.refreshTokens.create({
      tokenHash: refreshTokenHash(refreshToken),
      employeeId: user.employeeId,
      chainId: this.chainIdFactory(),
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + this.refreshTtlSeconds * 1000).toISOString(),
    })
    return this.issuePair(user, refreshToken, issuedAt)
  }

  async refresh(refreshToken: string): Promise<IssuedTokens> {
    const issuedAt = this.now()
    const nextRefreshToken = this.refreshTokenFactory()
    const rotation = this.refreshTokens.rotate(
      refreshTokenHash(refreshToken),
      refreshTokenHash(nextRefreshToken),
      issuedAt.toISOString(),
      new Date(issuedAt.getTime() + this.refreshTtlSeconds * 1000).toISOString(),
    )
    if (rotation.kind !== 'rotated') {
      throw new ApiError('UNAUTHORIZED', '刷新令牌无效或已失效')
    }

    const user = this.users.findByEmployeeId(rotation.employeeId)
    if (!user) throw new ApiError('UNAUTHORIZED', '刷新令牌无效或已失效')
    return this.issuePair(user, nextRefreshToken, issuedAt)
  }

  logout(refreshToken: string): void {
    this.refreshTokens.revokeOne(refreshTokenHash(refreshToken), this.now().toISOString())
  }

  async authenticate(authorization: string | undefined): Promise<AuthenticatedUser> {
    const match = /^Bearer\s+(\S+)$/.exec(authorization ?? '')
    if (!match?.[1]) throw new ApiError('UNAUTHORIZED', '登录已失效，请重新登录')

    try {
      const verified = await jwtVerify(match[1], this.encodedSecret, {
        algorithms: ['HS256'],
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        currentDate: this.now(),
      })
      const payload = verified.payload
      if (payload.token_use !== 'access' || typeof payload.sub !== 'string'
        || typeof payload.name !== 'string' || typeof payload.dept !== 'string'
        || (payload.role !== 'member' && payload.role !== 'admin')) {
        throw new Error('invalid access token claims')
      }
      return {
        employeeId: payload.sub,
        name: payload.name,
        dept: payload.dept,
        role: payload.role,
      }
    } catch {
      throw new ApiError('UNAUTHORIZED', '登录已失效，请重新登录')
    }
  }

  private async issuePair(user: UserRecord, refreshToken: string, issuedAt: Date): Promise<IssuedTokens> {
    const accessExpiresAt = new Date(issuedAt.getTime() + this.accessTtlSeconds * 1000)
    const accessToken = await new SignJWT({
      token_use: 'access',
      name: user.name,
      dept: user.dept,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setSubject(user.employeeId)
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(accessExpiresAt.getTime() / 1000))
      .sign(this.encodedSecret)

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtlSeconds,
      refreshExpiresIn: this.refreshTtlSeconds,
    }
  }
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12)
}

export function refreshTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}
