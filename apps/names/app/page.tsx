import {NamesClient} from "./NamesClient";
import {NotDeployed, TestnetNotice, Banner} from "@kaurax/ui";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Features {
  features: Array<{key: string; name: string; state: string; contract: string | null; detail: string}>;
  contracts: {names: string | null};
}

export default async function NamesPage() {
  // Availability is decided by the chain, not by a flag: /api/features calls eth_getCode.
  const features = await api<Features>("/api/features");
  const feature = features?.features.find((f) => f.key === "names") ?? null;
  const registry = features?.contracts?.names ?? null;
  const deployed = feature?.state === "testnet" && registry !== null;

  return (
    <div className="container page">
      <h1>KAURAX Names</h1>
      <p className="lede">
        Human-readable names for KAURAX addresses. Registered for a term, renewable, with a
        grace period so a missed renewal is recoverable.
      </p>

      <TestnetNotice />

      {!features ? (
        <Banner kind="err">
          <strong>The KAURAX API is not reachable</strong>, so this page cannot tell whether the
          registry is deployed. Nothing is shown rather than guessed.
        </Banner>
      ) : !deployed ? (
        <NotDeployed
          title="The KAURAX Names registry is not deployed on this network"
          what={feature?.detail ?? "No registry address is configured."}
          detail="Deploy it with: forge script script/DeployApps.s.sol:DeployApps"
        />
      ) : (
        <NamesClient
          registry={registry}
          rpcUrl={config.rpcUrl}
          chainId={config.chainId}
          explorerUrl={config.explorerUrl}
        />
      )}
    </div>
  );
}
