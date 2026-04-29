import { LoggerModule } from 'nestjs-pino';
import pino from 'pino';

const isProduction = process.env['NODE_ENV'] === 'production';

// Single shared Pino instance: framework logs (via NestJS Logger service)
// and HTTP request logs (via the pino-http middleware nestjs-pino registers)
// share the same stream. JSON to stdout — Docker/log shipper captures it.
export const pinoLogger = pino({
  level: isProduction ? 'info' : 'debug',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// CLAUDE: All HTTP logging config lives here, applied via nestjs-pino's
// auto-registered pino-http. Order with RequestIdMiddleware is fine even
// though the auto-mw fires before our request-id middleware: pino-http
// emits the log line on the response 'finish' event, by which point
// req.requestId has been set.
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
