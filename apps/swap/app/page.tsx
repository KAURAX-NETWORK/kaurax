import {SwapClient} from "./SwapClient";
import {NotDeployed, TestnetNotice, Banner} from "@kaurax/ui";
import {config, api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Features {
  features: Array<{key: string; state: string; detail: string}>;
  contracts: {swapRouter: string | null; swapFactory: string | null; wkax: string | null};
}

export default async function SwapPage() {
  const features = await api<Features>("/api/features");
  const feature = features?.features.find((f) => f.key === "swap") ?? null;
  const c = features?.contracts;
  const deployed = feature?.state === "testnet" && Boolean(c?.swapRouter && c?.swapFactory && c?.wkax);

  return (
    <div className="container page">
      <h1>KAURAX Swap</h1>
      <p className="lede">
        A constant-product automated market maker on KAURAX. Prices come from pool reserves,
        with 0.3% of every trade retained for liquidity providers.
      </p>

      <TestnetNotice />

      {!features ? (
        <Banner kind="err">
          <strong>The KAURAX API is not reachable</strong>, so this page cannot tell whether the AMM
          is deployed. Nothing is shown rather than guessed.
        </Banner>
      ) : !deployed ? (
        <NotDeployed
          title="KAURAX Swap is not deployed on this network"
          what={feature?.detail ?? "No AMM router is configured."}
          detail="Deploy it with: forge script script/DeployApps.s.sol:DeployApps"
        />
      ) : (
        <SwapClient
          router={c!.swapRouter!}
          factory={c!.swapFactory!}
          wkax={c!.wkax!}
          rpcUrl={config.rpcUrl}
          apiUrl={config.apiUrl}
          chainId={config.chainId}
          explorerUrl={config.explorerUrl}
        />
      )}
    </div>
  );
}
