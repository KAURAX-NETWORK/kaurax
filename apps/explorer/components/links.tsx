/**
 * The three links the explorer emits everywhere: a block, a transaction, an address.
 *
 * These use next/link rather than a raw anchor for one specific reason. The explorer is
 * served under a basePath ("/explorer"), and Next prepends that automatically for Link but
 * not for a plain <a>. As raw anchors these pointed at /block/42 rather than
 * /explorer/block/42, so every click from a listing landed on a 404 at the domain root —
 * on the site's most-used links, in the app whose entire job is following references.
 */
import Link from "next/link";
import {shortAddress, shortHash} from "@/lib/format";

export function BlockLink({number}: {number: bigint | string}) {
  return (
    <Link className="mono" href={`/block/${number}`}>
      {number.toString()}
    </Link>
  );
}

export function TxLink({hash, short = true}: {hash: string; short?: boolean}) {
  return (
    <Link className="mono" href={`/tx/${hash}`}>
      {short ? shortHash(hash) : hash}
    </Link>
  );
}

export function AddressLink({address, short = true}: {address: string | null; short?: boolean}) {
  if (!address) return <span className="faint">—</span>;
  return (
    <Link className="mono" href={`/address/${address}`}>
      {short ? shortAddress(address) : address}
    </Link>
  );
}
