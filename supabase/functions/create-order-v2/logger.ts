import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
export type LogContext = Record<string, unknown>;
export class EdgeLogger {
  service: string; requestId: string; context: LogContext;
  constructor(service: string, options: any = {}) {
    this.service = service;
    this.requestId = options.requestId || crypto.randomUUID();
    this.context = options.context || {};
  }
  withContext(c: LogContext) { return new EdgeLogger(this.service, { requestId: this.requestId, context: { ...this.context, ...c } }); }
  injectResponseHeaders(headers: HeadersInit = {}) { const h = new Headers(headers); h.set("X-Request-Id", this.requestId); return h; }
  startTimer(_n: string) { return { done: (_?: any) => 0 }; }
  idempotency(d: string, details?: any) { this.info(d, details); }
  debug(m: string, c?: any) { console.log(JSON.stringify({ level: "DEBUG", service: this.service, message: m, ...c })); }
  info(m: string, c?: any) { console.log(JSON.stringify({ level: "INFO", service: this.service, message: m, ...c })); }
  warn(m: string, c?: any) { console.warn(JSON.stringify({ level: "WARN", service: this.service, message: m, ...c })); }
  error(m: string, e?: unknown, c?: any, _s = true) { console.error(JSON.stringify({ level: "ERROR", service: this.service, message: m, error: String(e), ...c })); }
  fatal(m: string, e?: unknown, c?: any) { this.error(m, e, c); }
}
export function createLogger(service: string, options: any = {}) { return new EdgeLogger(service, options); }
