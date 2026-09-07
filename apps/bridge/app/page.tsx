import {BridgeClient} from "./BridgeClient";
import {Banner, TestnetNotice} from "@kaurax/ui";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Settlement {
  l2?: {chainId: number; name: string; isLocalDevnet: boolean};
  contracts?: Record<string, string | null>;
  outputOracle?: {finalizationPeriodSeconds: string | null};
}

interface Network {
  chainId: number;
  settlesTo: {chainId: number; name: string} | null;
}

export default async function BridgePage() {
  const [settlement, network] = await Promise.all([
    api<Settlement>("/api/network/settlement"),
    api<Network>("/api/network"),
  ]);

  const portal = settlement?.contracts?.portal ?? null;

  return (
    <div className="container page">
      <h1>KAURAX Bridge</h1>
      <p className="lede">
        Move KAX between the underlying Layer-2 and KAURAX. Deposits are derived from an L2
        event, so the sequencer cannot censor them. Withdrawals are proven by Merkle
        inclusion under a state commitment published on the L2.
      </p>

      <TestnetNotice />

      {!portal ? (
        <Banner kind="err">
          <strong>The bridge portal address is not configured on this deployment.</strong>{" "}
          Without it there is nothing to deposit into, so no bridging interface is shown.
        </Banner>
      ) : (
        <BridgeClient
          l3ChainId={network?.chainId ?? config.chainId}
          l3RpcUrl={config.rpcUrl}
          l2ChainId={settlement?.l2?.chainId ?? null}
          l2Name={settlement?.l2?.name ?? null}
          l2RpcUrl={process.env.NEXT_PUBLIC_L2_RPC_URL ?? ""}
          l1ChainId={null}
          portal={portal}
          challengeWindowSeconds={
            settlement?.outputOracle?.finalizationPeriodSeconds
              ? Number(settlement.outputOracle.finalizationPeriodSeconds)
              : null
          }
          l2BlockTimeSeconds={2}
        />
      )}
    </div>
  );
}
