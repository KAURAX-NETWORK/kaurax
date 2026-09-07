/** Minimal structured logger, matching kaurax-node's format so logs interleave readably. */
const ORDER: Record<string, number> = {debug: 10, info: 20, warn: 30, error: 40};
let threshold = ORDER.info!;

export function setLogLevel(level: string): void {
  threshold = ORDER[level] ?? ORDER.info!;
}

function emit(level: string, component: string, msg: string, fields?: Record<string, unknown>): void {
  if ((ORDER[level] ?? 20) < threshold) return;
  const extra = fields
    ? " " +
      Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : JSON.stringify(v)}`)
        .join(" ")
    : "";
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${component}] ${msg}${extra}`;
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export function createLogger(component: string) {
  return {
    debug: (m: string, f?: Record<string, unknown>) => emit("debug", component, m, f),
    info: (m: string, f?: Record<string, unknown>) => emit("info", component, m, f),
    warn: (m: string, f?: Record<string, unknown>) => emit("warn", component, m, f),
    error: (m: string, f?: Record<string, unknown>) => emit("error", component, m, f),
  };
}
