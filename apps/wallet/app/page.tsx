import {WalletClient} from "./WalletClient";
import {config} from "@/lib/config";
import {api} from "@/lib/config";

export const dynamic = "force-dynamic";

interface Network {
  name: string;
  chainId: number;
  currency: {name: string; symbol: string; decimals: number};
  head: string;
}

export default async function WalletPage() {
  // Read the network description from the API so the wallet never advertises a chain ID
  // that the running node disagrees with.
  const network = await api<Network>("/api/network");

  return (
    <div className="container page">
      <h1>KAURAX Wallet</h1>
      <p className="lede">
        Connect any Ethereum wallet to KAURAX, check your KAX balance and send transactions.
        KAURAX is EVM-equivalent, so no special wallet software is needed.
      </p>
      <WalletClient
        chainId={network?.chainId ?? config.chainId}
        networkName={network?.name ?? "KAURAX"}
        rpcUrl={config.rpcUrl}
        explorerUrl={config.explorerUrl}
        apiUrl={config.apiUrl}
        head={network?.head ?? null}
      />
    </div>
  );
}
