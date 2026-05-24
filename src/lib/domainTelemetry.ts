type LogLevel = 'info' | 'warn' | 'error';

function toLogLine(level: LogLevel, message: string, context: Record<string, unknown>) {
  return {
    scope: 'custom-domains',
    level,
    message,
    ...context,
  };
}

export function logDomain(level: LogLevel, message: string, context: Record<string, unknown>) {
  const payload = toLogLine(level, message, context);
  if (level === 'error') {
    console.error(payload);
    return;
  }
  if (level === 'warn') {
    console.warn(payload);
    return;
  }
  console.info(payload);
}

export function metricDomain(name: string, value: number, tags: Record<string, string | number | boolean>) {
  // Lightweight metric emission via structured logs; scrape downstream in the log pipeline.
  console.info({
    scope: 'custom-domains.metric',
    metric: name,
    value,
    tags,
    at: new Date().toISOString(),
  });
}
