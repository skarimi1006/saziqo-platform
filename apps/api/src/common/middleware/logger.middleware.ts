import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';

const isProduction = process.env['NODE_ENV'] === 'production';
const logLevel = process.env['LOG_LEVEL'] ?? (isProduction ? 'info' : 'debug');

const baseOptions: pino.LoggerOptions = {
  level: logLevel,
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
};

// All HTTP logging config lives here. Framework logs (NestJS Logger service)
// and HTTP request logs (pino-http auto-middleware from nestjs-pino) share
// the same stream so they end up in the same destination.
//
// Production: JSON lines to a bind-mounted log file so the host logrotate
// (Phase 15D) can rotate without restarting the container. Async SonicBoom
// batches writes; the host logrotate config uses `copytruncate` not SIGHUP.
//
// Dev: pino-pretty pretty-prints to stdout for human-readable output.
function buildPinoLogger(): pino.Logger {
  if (isProduction) {
    const logFile = process.env['LOG_FILE'] ?? '/var/log/saziqo-api/api.log';
    const dest = pino.destination({ dest: logFile, sync: false });
    return pino(baseOptions, dest);
  }

  const transport = pino.transport({
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
  });
  return pino(baseOptions, transport);
}

export const pinoLogger = buildPinoLogger();

export const PinoLoggerModule = LoggerModule.forRoot({
  pinoHttp: {
    logger: pinoLogger,
    genReqId: (req) => req.requestId ?? 'unknown',
    customProps: (req) => ({
      requestId: req.requestId,
      userAgent: req.headers['user-agent'],
    }),
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res, latencyMs) =>
      `${req.method} ${req.url} ${res.statusCode} ${latencyMs}ms`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} ${res.statusCode} ${err.message}`,
  },
});
