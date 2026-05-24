type LogLevel = "info" | "warn" | "error";

function toLogLine(level: LogLevel, message: string, context: Record<string, unknown>) {
  return {
    scope: "forms",
    level,
    message,
    ...context,
  };
}

export function logForm(level: LogLevel, message: string, context: Record<string, unknown>) {
  const payload = toLogLine(level, message, context);
  if (level === "error") {
    console.error(payload);
    return;
  }
  if (level === "warn") {
    console.warn(payload);
    return;
  }
  console.info(payload);
}

export function metricForm(name: string, value: number, tags: Record<string, string | number | boolean>) {
  console.info({
    scope: "forms.metric",
    metric: name,
    value,
    tags,
    at: new Date().toISOString(),
  });
}
