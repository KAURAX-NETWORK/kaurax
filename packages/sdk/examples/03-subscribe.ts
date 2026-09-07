/** Stream KAURAX blocks over WebSocket. Ctrl-C to stop. */
import {connect} from "../src/index.js";

const kaurax = await connect({
  rpcUrl: process.env.KAURAX_RPC_URL ?? "http://127.0.0.1:8420",
  wsUrl: process.env.KAURAX_WS_URL ?? "ws://127.0.0.1:8421",
});

const unsubscribe = kaurax.subscribeBlocks(
  (block) => console.log(`block ${block.number}  ${block.hash}  gasUsed=${block.gasUsed}`),
  (err) => console.error("subscription error:", err.message),
);

process.on("SIGINT", () => {
  unsubscribe();
  process.exit(0);
});
