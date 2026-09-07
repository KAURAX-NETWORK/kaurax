import {LaunchpadClient} from "./LaunchpadClient";
import {NotDeployed, TestnetNotice, Banner} from "@kaurax/ui";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Features {
  features: Array<{key: string; state: string; detail: string}>;
  contracts: {launchpad: string | null};
}

export default async function LaunchpadPage() {
  const features = await api<Features>("/api/features");
  const feature = features?.features.find((f) => f.key === "launchpad") ?? null;
  const launchpad = features?.contracts?.launchpad ?? null;
  const deployed = feature?.state === "testnet" && launchpad !== null;

  return (
    <div className="container page">
      <h1>KAURAX Launchpad</h1>
      <p className="lede">
        Token sales on KAURAX. Tokens are escrowed before a sale opens, and if the soft cap is
        missed every contributor can withdraw in full — the creator receives nothing.
      </p>

      <TestnetNotice />

      {!features ? (
        <Banner kind="err">
          <strong>The KAURAX API is not reachable</strong>, so this page cannot tell whether the
          launchpad is deployed. Nothing is shown rather than guessed.
        </Banner>
      ) : !deployed ? (
        <NotDeployed
          title="The KAURAX Launchpad is not deployed on this network"
          what={feature?.detail ?? "No launchpad address is configured."}
          detail="Deploy it with: forge script script/DeployApps.s.sol:DeployApps"
        />
      ) : (
        <LaunchpadClient
          launchpad={launchpad}
          rpcUrl={config.rpcUrl}
          chainId={config.chainId}
          explorerUrl={config.explorerUrl}
        />
      )}
    </div>
  );
}
