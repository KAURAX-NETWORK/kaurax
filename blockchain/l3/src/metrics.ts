/**
 * Prometheus text-format metrics.
 *
 * Every series is read from live component state at scrape time. There is no synthetic or
 * back-filled series: a value that cannot be determined is simply not emitted, so a gap in
 * a dashboard means "not measured", not "zero".
 */
import {createServer, type Server} from "node:http";
import {createLogger} from "./log.js";

export type MetricSource = () => Promise<Array<{name: string; help: string; type: string; value: number}>>;

export class MetricsServer {
  private readonly log = createLogger("metrics");
  private server: Server | null = null;

  constructor(
    private readonly port: number,
    private readonly source: MetricSource,
  ) {}

  async listen(): Promise<void> {
    this.server = createServer(async (req, res) => {
      if (req.url !== "/metrics") {
        res.writeHead(404).end("not found\n");
        return;
      }
      try {
        const series = await this.source();
        const body = series
          .map((s) => `# HELP ${s.name} ${s.help}\n# TYPE ${s.name} ${s.type}\n${s.name} ${s.value}`)
          .join("\n");
        res.writeHead(200, {"content-type": "text/plain; version=0.0.4"});
        res.end(body + "\n");
      } catch (err) {
        res.writeHead(500).end(`# metrics unavailable: ${(err as Error).message}\n`);
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.port, "0.0.0.0", resolve);
    });
    this.log.info("metrics listening", {url: `http://0.0.0.0:${this.port}/metrics`});
  }

  async close(): Promise<void> {
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }
}
