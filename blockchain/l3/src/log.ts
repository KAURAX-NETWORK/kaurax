/** Structured, level-filtered logging shared by every node component. */
export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = {debug: 10, info: 20, warn: 30, error: 40};

let threshold: number = ORDER.info;

export function setLogLevel(level: LogLevel): void {
  threshold = ORDER[level] ?? ORDER.info;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(component: string): Logger;
}

function emit(level: LogLevel, component: string, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const ts = new Date().toISOString();
  const extra = fields && Object.keys(fields).length > 0 ? ` ${format(fields)}` : "";
  const line = `${ts} ${level.toUpperCase().padEnd(5)} [${component}] ${msg}${extra}`;
  if (level === "error") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

function format(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "bigint" ? v.toString() : JSON.stringify(v)}`)
    .join(" ");
}

export function createLogger(component: string): Logger {
  return {
    debug: (m, f) => emit("debug", component, m, f),
    info: (m, f) => emit("info", component, m, f),
    warn: (m, f) => emit("warn", component, m, f),
    error: (m, f) => emit("error", component, m, f),
    child: (sub) => createLogger(`${component}:${sub}`),
  };
}
