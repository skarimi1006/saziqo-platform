import '../bigint-serialization';

import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { SignJWT } from 'jose';

import { ConfigService } from '../../config/config.service';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ErrorCode } from '../types/response.types';

import { JwtAuthGuard } from './jwt-auth.guard';

const TEST_SECRET = 'a'.repeat(48);

interface MockPrisma {
  impersonationSession: { findUnique: jest.Mock };
}

function makeContext(headers: Record<string, string>): {
  ctx: ExecutionContext;
  request: { headers: Record<string, string>; user?: unknown; impersonation?: unknown };
} {
  const request: { headers: Record<string, string>; user?: unknown; impersonation?: unknown } = {
    headers,
  };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { ctx, request };
}

async function makeAccessToken(
  sub: string,
  impClaim?: { actorUserId: string; impSessionId: string },
): Promise<string> {
  const payload: Record<string, unknown> = { type: 'access' };
  if (impClaim) payload['imp'] = impClaim;
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(new TextEncoder().encode(TEST_SECRET));
}

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = { impersonationSession: { findUnique: jest.fn() } };
    const config = {
      get: (key: string) => (key === 'JWT_SECRET' ? TEST_SECRET : undefined),
    } as unknown as ConfigService;
    guard = new JwtAuthGuard(config, prisma as unknown as PrismaService);
  });

  it('attaches request.user from sub when there is no imp claim', async () => {
    const token = await makeAccessToken('7');
    const { ctx, request } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 7n });
    expect(request.impersonation).toBeUndefined();
    expect(prisma.impersonationSession.findUnique).not.toHaveBeenCalled();
  });

  it('attaches both user (target) and impersonation (actor) when the imp claim is valid and the row is active', async () => {
    prisma.impersonationSession.findUnique.mockResolvedValue({
      endedAt: null,
      actorUserId: 1n,
      targetUserId: 5n,
    });
    const token = await makeAccessToken('5', { actorUserId: '1', impSessionId: '42' });
    const { ctx, request } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toEqual({ id: 5n });
    expect(request.impersonation).toEqual({ actorUserId: 1n, impSessionId: 42n });
    expect(prisma.impersonationSession.findUnique).toHaveBeenCalledWith({
      where: { id: 42n },
      select: { endedAt: true, actorUserId: true, targetUserId: true },
    });
  });

  it('rejects with IMPERSONATION_ENDED when the row has endedAt set', async () => {
    prisma.impersonationSession.findUnique.mockResolvedValue({
      endedAt: new Date(),
      actorUserId: 1n,
      targetUserId: 5n,
    });
    const token = await makeAccessToken('5', { actorUserId: '1', impSessionId: '42' });
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: ErrorCode.IMPERSONATION_ENDED },
      status: HttpStatus.UNAUTHORIZED,
    });
  });

  it('rejects with IMPERSONATION_ENDED when actor or target in the row do not match the JWT claim', async () => {
    prisma.impersonationSession.findUnique.mockResolvedValue({
      endedAt: null,
      actorUserId: 99n,
      targetUserId: 5n,
    });
    const token = await makeAccessToken('5', { actorUserId: '1', impSessionId: '42' });
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: ErrorCode.IMPERSONATION_ENDED },
    });
  });

  it('rejects when the impersonation row does not exist', async () => {
    prisma.impersonationSession.findUnique.mockResolvedValue(null);
    const token = await makeAccessToken('5', { actorUserId: '1', impSessionId: '42' });
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: ErrorCode.IMPERSONATION_ENDED },
    });
  });

  it('rejects malformed imp claim with UNAUTHORIZED', async () => {
    const token = await new SignJWT({ type: 'access', imp: { actorUserId: 1, impSessionId: 42 } })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('5')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode(TEST_SECRET));
    const { ctx } = makeContext({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: ErrorCode.UNAUTHORIZED },
    });
  });

  it('rejects requests with no Authorization header', async () => {
    const { ctx } = makeContext({});
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { code: ErrorCode.UNAUTHORIZED },
    });
  });
});
