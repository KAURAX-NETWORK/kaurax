import {AiClient} from "./AiClient";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  detail: string;
}

export default async function AiPage() {
  // Whether AI works at all is a server-side fact. Ask the API rather than assuming.
  const status = await api<AiStatus>("/api/ai/status");

  return (
    <div className="container page">
      <h1>KAURAX AI</h1>
      <p className="lede">
        An assistant for the KAURAX network. Requests are routed through the KAURAX API to
        the xKiro gateway — the API key stays on the server and never reaches your browser.
      </p>
      <AiClient
        apiUrl={config.apiUrl}
        configured={status?.configured ?? false}
        provider={status?.provider ?? "xkiro"}
        model={status?.model ?? null}
        detail={status?.detail ?? "Could not reach the KAURAX API to determine AI availability."}
        reachable={status !== null}
      />
    </div>
  );
}
