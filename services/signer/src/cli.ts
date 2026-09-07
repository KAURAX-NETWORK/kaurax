#!/usr/bin/env node
/**
 * Runs the signing service.
 *
 * Refuses to start without a token, and refuses to start with no keys at all — a signer
 * with nothing to sign is a misconfiguration that would otherwise only surface as a
 * confusing 404 when the node asks for an address.
 */
import {InMemoryKeystore} from "./keystore.js";
import {createSignerServer} from "./server.js";

const token = process.env.KAURAX_SIGNER_TOKEN;
if (!token) {
  process.stderr.write(
    "KAURAX_SIGNER_TOKEN is not set. Generate one with `openssl rand -hex 32` and give the\n" +
      "same value to the node as KAURAX_SIGNER_TOKEN.\n",
  );
  process.exit(1);
}

const keystore = InMemoryKeystore.fromEnv();
if (keystore.roles().length === 0) {
  process.stderr.write(
    "No operator keys configured. Set at least one of SEQUENCER_PRIVATE_KEY,\n" +
      "BATCHER_PRIVATE_KEY, PROPOSER_PRIVATE_KEY in this service's environment.\n",
  );
  process.exit(1);
}

const host = process.env.KAURAX_SIGNER_HOST ?? "127.0.0.1";
if (host !== "127.0.0.1" && host !== "localhost" && process.env.KAURAX_SIGNER_ALLOW_PUBLIC !== "true") {
  process.stderr.write(
    `Refusing to bind the signing service to ${host}. This process holds private keys and\n` +
      `should be reachable only from the node. If you genuinely front it with mTLS or a\n` +
      `private network, set KAURAX_SIGNER_ALLOW_PUBLIC=true.\n`,
  );
  process.exit(1);
}

const service = createSignerServer({
  keystore,
  token,
  host,
  port: Number(process.env.KAURAX_SIGNER_PORT ?? 8555),
});

await service.listen();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void service.close().then(() => process.exit(0));
  });
}
