/**
 * Generates the scenario blockchain/contracts/test/KVSFaultDisputeGame.t.sol plays against.
 *
 *   pnpm --filter @kaurax/kvs game-fixture
 *
 * One short program, its honest trace, and a step proof for every step. That is enough for
 * a Solidity test to play a complete game: an honest proposer answers each bisection with a
 * real state hash, a lying one answers with something else, and at the leaf the verifier
 * settles it either way.
 *
 * The program touches arithmetic and storage on purpose. A scenario made only of stack
 * operations would never exercise the storage proof path, which is where the one real
 * soundness bug in this work was found.
 */
import {writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {encodeAbiParameters} from "viem";
import {Machine} from "../src/machine.js";
import {encodeStepProof, encodeMachineState} from "../src/encode.js";
import {hashState, isTerminal} from "../src/state.js";
import {commit} from "../src/trace.js";
import type {Hex} from "../src/merkle.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../blockchain/contracts/test/fixtures/kvs-game.hex");

// PUSH1 5 / PUSH1 3 / ADD / PUSH1 1 / SSTORE / PUSH1 1 / SLOAD / STOP
// SSTORE takes the key on top of the value, so 8 lands in slot 1 and is read back.
const CODE = Uint8Array.from([0x60, 0x05, 0x60, 0x03, 0x01, 0x60, 0x01, 0x55, 0x60, 0x01, 0x54, 0x00]);

const m = new Machine(CODE, 100_000n);
const stateHashes: Hex[] = [hashState(m.state())];
const proofs: Hex[] = [];

for (let i = 0; i < 64; i++) {
  if (isTerminal(m.state())) break;
  const r = m.step();
  proofs.push(encodeStepProof(r.pre, r.proof));
  stateHashes.push(hashState(r.post));
}

const {root, height} = commit(stateHashes);

// The final state travels as a struct as well as a hash. Field-level tampering — a wrong
// storage root, a wrong gas figure, a wrong stack root — is what the adversarial tests need,
// and reconstructing a MachineState inside Solidity would mean maintaining a third
// implementation of the state layout.
const blob = encodeAbiParameters(
  [
    {
      type: "tuple",
      components: [
        {name: "code", type: "bytes"},
        {name: "states", type: "bytes32[]"},
        {name: "stepProofs", type: "bytes[]"},
        {name: "traceRoot", type: "bytes32"},
        {name: "traceHeight", type: "uint256"},
        {name: "finalState", type: "bytes"},
      ],
    },
  ],
  [
    {
      code: `0x${Buffer.from(CODE).toString("hex")}` as Hex,
      states: stateHashes,
      stepProofs: proofs,
      traceRoot: root,
      traceHeight: BigInt(height),
      finalState: encodeMachineState(m.state()),
    },
  ] as never,
);

mkdirSync(dirname(OUT), {recursive: true});
writeFileSync(OUT, blob);
console.log(
  `[kvs] game scenario: ${proofs.length} steps, ${stateHashes.length} states, trace root ${root} -> ${OUT}`,
);
