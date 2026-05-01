import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ConfigService } from '../../config/config.service';

import { EmailService } from './email.service';
import { ConsoleEmailProvider } from './providers/console.provider';
import { SmtpEmailProvider } from './providers/smtp.provider';

describe('ConsoleEmailProvider', () => {
  let provider: ConsoleEmailProvider;
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ConsoleEmailProvider],
    }).compile();
    provider = moduleRef.get(ConsoleEmailProvider);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => logSpy.mockRestore());

  it('logs with [EMAIL CONSOLE] prefix and returns a console-{uuid} messageId', async () => {
    const result = await provider.send({
      to: 'user@example.com',
      subject: 'تست',
      textBody: 'متن تست',
    });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL CONSOLE]'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('user@example.com'));
    expect(result.messageId).toMatch(/^console-[0-9a-f-]{36}$/);
  });

  it('each call returns a unique messageId', async () => {
    const a = await provider.send({ to: 'a@b.com', subject: 's', textBody: 'b' });
    const b = await provider.send({ to: 'a@b.com', subject: 's', textBody: 'b' });
    expect(a.messageId).not.toBe(b.messageId);
  });
});

describe('SmtpEmailProvider', () => {
  it('throws EMAIL_PROVIDER_NOT_CONFIGURED when instantiated', () => {
    expect(() => new SmtpEmailProvider()).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });
});

describe('EmailService', () => {
  function buildService(emailProvider: string) {
    const mockConfig = { get: jest.fn().mockReturnValue(emailProvider) };
    const mockConsole = {
      name: 'console',
      send: jest.fn().mockResolvedValue({ messageId: 'console-test-id' }),
    };
    return { mockConfig, mockConsole };
  }

  describe('provider selection', () => {
    it('uses console provider when EMAIL_PROVIDER=console', async () => {
      const { mockConfig, mockConsole } = buildService('console');

      const moduleRef = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfig },
          { provide: ConsoleEmailProvider, useValue: mockConsole },
        ],
      }).compile();

      await moduleRef.init();
      const service = moduleRef.get(EmailService);
      await service.send({ to: 'x@y.com', subject: 'hi', textBody: 'hello' });

      expect(mockConsole.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'x@y.com' }));
    });

    it('throws at startup when EMAIL_PROVIDER=smtp', async () => {
      const { mockConfig, mockConsole } = buildService('smtp');

      const moduleRef = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfig },
          { provide: ConsoleEmailProvider, useValue: mockConsole },
        ],
      }).compile();

      await expect(moduleRef.init()).rejects.toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
    });
  });

  describe('render', () => {
    let service: EmailService;

    beforeEach(async () => {
      const { mockConfig, mockConsole } = buildService('console');

      const moduleRef = await Test.createTestingModule({
        providers: [
          EmailService,
          { provide: ConfigService, useValue: mockConfig },
          { provide: ConsoleEmailProvider, useValue: mockConsole },
        ],
      }).compile();

      await moduleRef.init();
      service = moduleRef.get(EmailService);
    });

    it('renders the welcome template with firstName substitution', () => {
      const result = service.render('welcome', { firstName: 'علی' });
      expect(result.subject).toBe('به سازیکو خوش آمدید');
      expect(result.textBody).toContain('علی');
    });

    it('renders payment_succeeded with amount and reference', () => {
      const result = service.render('payment_succeeded', {
        amount: '50,000',
        reference: 'REF-123',
      });
      expect(result.subject).toBe('پرداخت شما تأیید شد');
      expect(result.textBody).toContain('50,000');
      expect(result.textBody).toContain('REF-123');
    });

    it('renders payment_failed template', () => {
      const result = service.render('payment_failed', { amount: '10,000' });
      expect(result.textBody).toContain('10,000');
    });

    it('renders profile_completed with firstName', () => {
      const result = service.render('profile_completed', { firstName: 'مریم' });
      expect(result.textBody).toContain('مریم');
    });

    it('renders payout_approved with amount', () => {
      const result = service.render('payout_approved', { amount: '100,000' });
      expect(result.textBody).toContain('100,000');
    });

    it('throws for an unknown template key', () => {
      expect(() => service.render('nonexistent_template', {})).toThrow();
    });
  });
});
