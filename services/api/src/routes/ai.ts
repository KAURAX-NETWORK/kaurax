/**
 * KAURAX AI.
 *
 *   browser ──► KAURAX API ──► xKiro gateway ──► model
 *
 * The API key lives here and only here. It is never sent to a browser, never placed in a
 * NEXT_PUBLIC_ variable, and never echoed in a response or an error.
 *
 * xKiro (https://xkiro.com) is an OpenAI- and Anthropic-compatible gateway: one key, many
 * vendors, `vendor/model` identifiers. That means KAURAX is not coupled to a single model
 * provider — changing XKIRO_MODEL is the whole migration.
 *
 * When XKIRO_API_KEY is unset, these endpoints report themselves unconfigured. They do not
 * fall back to a canned reply: a user must never be shown generated-looking text that no
 * model produced.
 */
import type {FastifyInstance} from "fastify";
import type {Context} from "../context.js";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface XkiroResponse {
  choices?: Array<{message?: {content?: string}; finish_reason?: string}>;
  usage?: {prompt_tokens?: number; completion_tokens?: number; total_tokens?: number};
  model?: string;
  error?: {message?: string};
}

const SYSTEM_PROMPT = [
  "You are the KAURAX assistant. KAURAX is an application-focused Ethereum Layer-3 that",
  "settles through an underlying Layer-2, which settles to Ethereum. It is not a Layer-1.",
  "",
  "Be accurate about its limits, and never overstate them:",
  "- KAURAX has no fault proof system. Output roots posted to the L2 are trusted.",
  "- The sequencer is centralized, with no failover and no forced-exit hatch.",
  "- Nothing has been audited.",
  "- KAX is a testnet gas asset with no monetary value.",
  "",
  "Never give financial or investment advice, never suggest KAX has or will have value,",
  "and never claim a KAURAX feature is live unless the user has been told it is.",
  "If you do not know something about this deployment, say so.",
].join("\n");

/** Cap on what a single request may send upstream, in characters. */
const MAX_CHARS = 8_000;
const MAX_MESSAGES = 24;

export function registerAiRoutes(app: FastifyInstance, ctx: Context): void {
  /** Whether the AI feature is actually usable on this deployment. */
  app.get("/api/ai/status", async () => ({
    configured: ctx.cfg.ai.apiKey !== null,
    provider: "xkiro",
    baseUrl: ctx.cfg.ai.baseUrl,
    model: ctx.cfg.ai.model,
    detail:
      ctx.cfg.ai.apiKey !== null
        ? "KAURAX AI is configured and routed through the xKiro gateway."
        : "XKIRO_API_KEY is not set on the API server, so KAURAX AI is unavailable. " +
          "Set it server-side — never in a NEXT_PUBLIC_ variable.",
  }));

  app.post("/api/ai/chat", async (req, reply) => {
    if (!ctx.cfg.ai.apiKey) {
      return reply.code(503).send({
        error: "ai_not_configured",
        message:
          "KAURAX AI is not configured on this server. An operator must set XKIRO_API_KEY. " +
          "No response is generated without a configured provider.",
        statusCode: 503,
      });
    }

    const body = req.body as {messages?: ChatMessage[]; model?: string};
    const messages = Array.isArray(body?.messages) ? body.messages : [];

    if (messages.length === 0) {
      return reply
        .code(400)
        .send({error: "bad_request", message: "messages must be a non-empty array.", statusCode: 400});
    }
    if (messages.length > MAX_MESSAGES) {
      return reply.code(400).send({
        error: "bad_request",
        message: `At most ${MAX_MESSAGES} messages per request.`,
        statusCode: 400,
      });
    }

    const clean: ChatMessage[] = [];
    let chars = 0;
    for (const m of messages) {
      // A client must not be able to inject its own system prompt and talk the assistant
      // out of the constraints above.
      const role = m?.role === "assistant" ? "assistant" : "user";
      const content = typeof m?.content === "string" ? m.content : "";
      if (!content.trim()) continue;
      chars += content.length;
      if (chars > MAX_CHARS) {
        return reply.code(413).send({
          error: "too_large",
          message: `Conversation exceeds the ${MAX_CHARS}-character limit.`,
          statusCode: 413,
        });
      }
      clean.push({role, content});
    }
    if (clean.length === 0) {
      return reply
        .code(400)
        .send({error: "bad_request", message: "No message content provided.", statusCode: 400});
    }

    try {
      const upstream = await fetch(`${ctx.cfg.ai.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${ctx.cfg.ai.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          // The model is server-chosen. A client cannot select an arbitrary upstream model
          // and spend the operator's budget on it.
          model: ctx.cfg.ai.model,
          messages: [{role: "system", content: SYSTEM_PROMPT}, ...clean],
        }),
        signal: AbortSignal.timeout(60_000),
      });

      const data = (await upstream.json().catch(() => ({}))) as XkiroResponse;

      if (!upstream.ok) {
        // Surface that it failed and why in general terms — never the key, never the raw
        // upstream body, which can echo request headers.
        req.log.warn({status: upstream.status}, "xkiro request failed");
        return reply.code(502).send({
          error: "ai_upstream_error",
          message: `The AI provider returned ${upstream.status}. ${data.error?.message ?? ""}`.trim(),
          statusCode: 502,
        });
      }

      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.length === 0) {
        return reply.code(502).send({
          error: "ai_empty_response",
          message: "The AI provider returned no content.",
          statusCode: 502,
        });
      }

      return {
        content,
        model: data.model ?? ctx.cfg.ai.model,
        provider: "xkiro",
        usage: data.usage ?? null,
        finishReason: data.choices?.[0]?.finish_reason ?? null,
      };
    } catch (err) {
      const message = (err as Error).name === "TimeoutError" ? "The AI provider timed out." : "The AI provider could not be reached.";
      req.log.warn({err: (err as Error).message}, "xkiro request errored");
      return reply.code(502).send({error: "ai_unavailable", message, statusCode: 502});
    }
  });
}
