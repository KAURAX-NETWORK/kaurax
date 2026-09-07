import {shortAddress, shortHash} from "@/lib/format";

export function BlockLink({number}: {number: bigint | string}) {
  return (
    <a className="mono" href={`/block/${number}`}>
      {number.toString()}
    </a>
  );
}

export function TxLink({hash, short = true}: {hash: string; short?: boolean}) {
  return (
    <a className="mono" href={`/tx/${hash}`}>
      {short ? shortHash(hash) : hash}
    </a>
  );
}

export function AddressLink({address, short = true}: {address: string | null; short?: boolean}) {
  if (!address) return <span className="faint">—</span>;
  return (
    <a className="mono" href={`/address/${address}`}>
      {short ? shortAddress(address) : address}
    </a>
  );
}
