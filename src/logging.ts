// ---------------------------------------------------------------------------
// Logging — Section 13
// Structured logging with pino.
// ---------------------------------------------------------------------------

import pino from "pino";

export function createLogger(pretty = false): pino.Logger {
  const options: pino.LoggerOptions = {
    level: process.env.LOG_LEVEL ?? "info",
  };

  if (pretty) {
    return pino({
      ...options,
      transport: {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:standard",
        },
      },
    });
  }

  return pino(options);
}
