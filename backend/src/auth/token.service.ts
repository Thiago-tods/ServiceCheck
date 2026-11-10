import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get accessTtl(): number {
    return this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
  }

  private get refreshTtlMs(): number {
    return this.config.getOrThrow<number>('REFRESH_TTL_DAYS') * 24 * 60 * 60 * 1000;
  }

  private signAccess(userId: string): Promise<string> {
    return this.jwt.signAsync({ sub: userId }, { expiresIn: this.accessTtl });
  }

  /** Starts a new refresh-token family (login). */
  async issue(userId: string): Promise<TokenPair> {
    const raw = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId: randomUUID(),
        tokenHash: sha256(raw),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });
    return {
      accessToken: await this.signAccess(userId),
      refreshToken: raw,
      expiresIn: this.accessTtl,
    };
  }

  /**
   * Rotates a refresh token. Presenting an already-used token means it was
   * stolen or replayed, so the entire family is revoked.
   */
  async rotate(rawToken: string): Promise<{ pair: TokenPair; userId: string }> {
    const hash = sha256(rawToken);
    const current = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hash } });
    if (!current) throw new UnauthorizedException('Invalid refresh token');

    if (current.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (current.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    const nextRaw = randomBytes(48).toString('base64url');
    const nextId = randomUUID();
    const claimed = await this.prisma.$transaction(async (tx) => {
      // Atomic claim: only one concurrent request can revoke the live token.
      const res = await tx.refreshToken.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (res.count !== 1) return false;
      await tx.refreshToken.create({
        data: {
          id: nextId,
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: sha256(nextRaw),
          expiresAt: new Date(Date.now() + this.refreshTtlMs),
        },
      });
      return true;
    });
    if (!claimed) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    return {
      userId: current.userId,
      pair: {
        accessToken: await this.signAccess(current.userId),
        refreshToken: nextRaw,
        expiresIn: this.accessTtl,
      },
    };
  }

  /** Idempotent: revokes the token's whole family if it exists. */
  async revoke(rawToken: string): Promise<void> {
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!current) return;
    await this.prisma.refreshToken.updateMany({
      where: { familyId: current.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async verifyAccess(token: string): Promise<{ userId: string }> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token);
      return { userId: payload.sub };
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
