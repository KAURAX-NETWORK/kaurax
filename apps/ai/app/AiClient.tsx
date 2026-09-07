"use client";

/**
 * KAURAX AI chat.
 *
 *   browser ──► KAURAX API ──► xKiro gateway ──► model
 *
 * The browser never holds a provider key and never talks to a model directly.
 *
 * When the server has no key configured, this renders as unavailable and the input is
 * disabled. It does not fall back to a scripted reply: a user must never be shown text
 * that looks generated but is not.
 */
import {useCallback, useEffect, useRef, useState} from "react";
import {Badge, Banner, NotDeployed, Spinner, TestnetNotice} from "@kaurax/ui";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What is KAURAX and how does it settle to Ethereum?",
  "How do I add KAURAX to MetaMask?",
  "Explain how a withdrawal from KAURAX is proven on the L2.",
  "What are the risks of using KAURAX today?",
];

export function AiClient({
  apiUrl,
  configured,
  provider,
  model,
  detail,
  reachable,
}: {
  apiUrl: string;
  configured: boolean;
  provider: string;
  model: string | null;
  detail: string;
  reachable: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({top: logRef.current.scrollHeight, behavior: "smooth"});
  }, [messages, busy]);

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || busy) return;

      setError(null);
      const next: Message[] = [...messages, {role: "user", content}];
      setMessages(next);
      setInput("");
      setBusy(true);

      try {
        const res = await fetch(`${apiUrl}/api/ai/chat`, {
          method: "POST",
          headers: {"content-type": "application/json"},
          body: JSON.stringify({messages: next}),
          signal: AbortSignal.timeout(70_000),
        });
        const body = await res.json().catch(() => null);

        if (!res.ok) {
          // Surface the API's own explanation. No placeholder answer is inserted.
          setError((body as {message?: string} | null)?.message ?? `The API returned ${res.status}.`);
          return;
        }

        const reply = (body as {content?: string}).content;
        if (typeof reply !== "string" || reply.length === 0) {
          setError("The provider returned an empty response.");
          return;
        }
        setMessages((m) => [...m, {role: "assistant", content: reply}]);
      } catch (err) {
        setError(
          (err as Error).name === "TimeoutError"
            ? "The request timed out."
            : "Could not reach the KAURAX API.",
        );
      } finally {
        setBusy(false);
      }
    },
    [messages, busy, apiUrl],
  );

  if (!reachable) {
    return (
      <>
        <TestnetNotice />
        <Banner kind="err">
          <strong>The KAURAX API is not reachable.</strong> AI requests are proxied through
          it, so nothing can be answered from this page right now.
        </Banner>
      </>
    );
  }

  if (!configured) {
    return (
      <>
        <TestnetNotice />
        <NotDeployed
          title="KAURAX AI is not configured on this deployment"
          what={detail}
          detail="Set XKIRO_API_KEY on the API server. It must never be a NEXT_PUBLIC_ variable."
        />
        <div className="card" style={{marginTop: 18}}>
          <h2>How it will work once configured</h2>
          <pre style={{background: "var(--bg-inset)", padding: 16, borderRadius: 8, overflowX: "auto"}}>
{`browser  ──►  KAURAX API  ──►  xKiro gateway  ──►  model
              (holds the key)   (one key, many vendors)`}
          </pre>
          <p className="dim" style={{marginTop: 12, fontSize: 13}}>
            xKiro is OpenAI- and Anthropic-compatible, so KAURAX is not tied to one model
            vendor: changing <code>XKIRO_MODEL</code> is the whole migration.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <TestnetNotice />

      <div className="row-gap" style={{marginBottom: 14}}>
        <Badge kind="ok">provider: {provider}</Badge>
        {model ? <Badge>{model}</Badge> : null}
        <span className="right" />
        {messages.length > 0 ? <button onClick={() => setMessages([])}>Clear</button> : null}
      </div>

      <div className="card">
        <div className="chat">
          <div className="chat-log" ref={logRef}>
            {messages.length === 0 ? (
              <div className="center" style={{margin: "auto", maxWidth: 460}}>
                <p className="dim" style={{fontSize: 13.5}}>
                  Ask about KAURAX — its architecture, how to build on it, or what it does not
                  yet do.
                </p>
                <div className="stack-gap" style={{marginTop: 16}}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} onClick={() => void send(s)} style={{textAlign: "left"}}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`msg ${m.role}`}>
                  <pre>{m.content}</pre>
                </div>
              ))
            )}
            {busy ? (
              <div className="msg assistant pending">
                <Spinner /> thinking…
              </div>
            ) : null}
          </div>

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about KAURAX…"
              disabled={busy}
              aria-label="Message"
            />
            <button className="primary" type="submit" disabled={busy || input.trim().length === 0}>
              Send
            </button>
          </form>
        </div>
      </div>

      {error ? (
        <Banner kind="err">
          {error}
        </Banner>
      ) : null}

      <Banner kind="info">
        Replies come from a language model and can be wrong. KAURAX AI gives no financial
        advice, and KAX has no monetary value. Verify anything consequential against the
        documentation or the chain itself.
      </Banner>
    </>
  );
}
