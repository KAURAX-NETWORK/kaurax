import {PayClient} from "./PayClient";
import {config} from "@/lib/config";

export const dynamic = "force-dynamic";

export default function PayPage() {
  return (
    <div className="container page">
      <h1>KAURAX Pay</h1>
      <p className="lede">
        Create a payment request, share it, and let the payer settle it in KAX on KAURAX. A
        payment is only marked confirmed once the KAURAX API has verified the transaction on
        chain — recipient, amount and receipt status all have to match.
      </p>
      <PayClient
        apiUrl={config.apiUrl}
        rpcUrl={config.rpcUrl}
        chainId={config.chainId}
        explorerUrl={config.explorerUrl}
      />
    </div>
  );
}
