import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { RedisService } from '../../src/core/redis/redis.service';

// Drives the diagnostics endpoint past the default 30/min/ip limit and
// verifies that the 31st request is rejected with the canonical envelope.
describe('Rate limiting (integration)', () => {
  let app: INestApplication;
  let redis: RedisService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    app.setGlobalPrefix('api/v1');
    await app.init();

    redis = app.get(RedisService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Wipe rate-limit state so each test starts from a clean window.
    const client = redis.getClient();
    const keys = await client.keys('ratelimit:*');
    if (keys.length > 0) {
      await client.del(...keys);
    }
  });

  it('returns 429 on the 31st request from the same IP within 60 seconds', async () => {
    const path = '/api/v1/_diagnostics/echo?msg=test';
    const server = app.getHttpServer();

    // First 30 requests succeed.
    for (let i = 0; i < 30; i += 1) {
      const res = await request(server).get(path);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { echo: 'test' } });
      expect(res.headers['x-ratelimit-limit']).toBe('30');
      expect(Number(res.headers['x-ratelimit-remaining'])).toBe(29 - i);
    }

    // 31st request is rate-limited.
    const limited = await request(server).get(path);
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(limited.body.error.details.scope).toBe('ip');
    expect(limited.body.error.details.limit).toBe(30);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['x-ratelimit-limit']).toBe('30');
    expect(limited.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('exposes X-RateLimit-* headers on every successful response', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/_diagnostics/echo?msg=hi');
    expect(res.status).toBe(200);
    expect(res.headers['x-ratelimit-limit']).toBe('30');
    expect(res.headers['x-ratelimit-remaining']).toBe('29');
    expect(res.headers['x-ratelimit-reset']).toMatch(/^\d+$/);
  });
});
