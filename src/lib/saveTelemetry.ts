type SaveLogLevel = "info" | "warn" | "error";

function log(level: SaveLogLevel, message: string, context: Record<string, unknown>) {
  const payload = {
    scope: "save",
    level,
    message,
    at: new Date().toISOString(),
    ...context,
  };
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

export function logSaveInfo(message: string, context: Record<string, unknown>) {
  log("info", message, context);
}

export function logSaveWarn(message: string, context: Record<string, unknown>) {
  log("warn", message, context);
}

export function logSaveError(message: string, context: Record<string, unknown>) {
  log("error", message, context);
}

export function metricSave(name: string, value: number, tags: Record<string, string | number | boolean>) {
  console.info({
    scope: "save.metric",
    metric: name,
    value,
    tags,
    at: new Date().toISOString(),
  });
}

