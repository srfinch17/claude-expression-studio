// A tiny Server-Sent Events fan-out hub. No HTTP knowledge here:
// it holds "clients" (anything with write()) and frames each DisplayEvent as one SSE
// message. A client that throws on write (browser tab closed) is dropped, never
// propagated, broadcast() is best-effort and MUST NOT throw into runPlan().

export interface DisplayEvent {
  kind: "frames" | "animation" | "noop";
  name?: string;
  wire?: unknown;                       // expressionToWire() output for the frames path
  type?: string;                        // firmware animation type
  params?: Record<string, unknown>;
  brightness?: number;
}

export interface SseClient {
  write(chunk: string): void;
  end?(): void;
  on?(ev: string, cb: () => void): void;
}

export class SseHub {
  private clients = new Set<SseClient>();
  addClient(res: SseClient): void { this.clients.add(res); }
  removeClient(res: SseClient): void { this.clients.delete(res); }
  clientCount(): number { return this.clients.size; }
  broadcast(event: DisplayEvent): void {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const c of [...this.clients]) {
      try { c.write(msg); } catch { this.clients.delete(c); }
    }
  }
}
