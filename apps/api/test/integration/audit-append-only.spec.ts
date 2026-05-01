import 'reflect-metadata';
import '../../src/common/bigint-serialization';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

import { AppModule } from '../../src/app.module';
import { AuditService } from '../../src/core/audit/audit.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';

// SECURITY: This test exercises the database trigger installed by the
// 20260501100000_audit_log_append_only migration. It must run against a
// real Postgres — do not mock PrismaService here. The trigger is the
// only line of defense against an attacker (or a buggy ORM call) altering
// the audit history; if these assertions ever stop holding, audit
// integrity is broken even when the application code is correct.
describe('audit_logs append-only DB enforcement', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let audit: AuditService;
  let writtenId: bigint;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ bufferLogs: false });
    await app.init();

    prisma = app.get(PrismaService);
    audit = app.get(AuditService);

    await audit.log({
      actorUserId: null,
      action: 'TEST_APPEND_ONLY',
      resource: 'audit_test',
      resourceId: null,
      payload: { test: 'append-only' },
      ipAddress: null,
      userAgent: null,
    });

    const row = await prisma.auditLog.findFirst({
      where: { action: 'TEST_APPEND_ONLY' },
      orderBy: { id: 'desc' },
    });
    if (!row) throw new Error('audit row was not written by AuditService.log');
    writtenId = row.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks UPDATE on audit_logs via the prevent_audit_log_modification trigger', async () => {
    await expect(
      prisma.$executeRaw`UPDATE "audit_logs" SET "action" = 'TAMPERED' WHERE "id" = ${writtenId}`,
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.auditLog.findUnique({ where: { id: writtenId } });
    expect(row?.action).toBe('TEST_APPEND_ONLY');
  });

  it('blocks DELETE on audit_logs via the prevent_audit_log_modification trigger', async () => {
    await expect(
      prisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${writtenId}`,
    ).rejects.toThrow(/append-only/i);

    const row = await prisma.auditLog.findUnique({ where: { id: writtenId } });
    expect(row).not.toBeNull();
  });
});
