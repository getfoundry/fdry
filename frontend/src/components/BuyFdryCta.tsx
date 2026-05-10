import { FDRY_JUPITER_URL } from "../lib/voltrConfig";

type Props = {
  amount?: number;
  balance?: number | null;
  connected?: boolean;
  assetSymbol?: string;
  symbol?: string;
};

export function BuyFdryCta({
  amount = 0,
  balance = null,
  connected = false,
  assetSymbol,
  symbol = assetSymbol ?? "FDRY",
}: Props) {
  const shortfall = balance == null ? 0 : Math.max(0, amount - balance);
  const needsMore = connected && shortfall > 0.000001;

  return (
    <div className="rounded-2xl border border-ember/30 bg-sunrise/70 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-display text-sm font-semibold lowercase text-ink">
            {needsMore ? `need ${shortfall.toLocaleString()} more ${symbol}` : `need ${symbol}?`}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Buy FDRY on Jupiter first, then come back here and deposit into Voltr.
          </p>
        </div>
        <a
          href={FDRY_JUPITER_URL}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-molten px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-ember/15 transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-ember focus:ring-offset-2"
        >
          Buy FDRY
        </a>
      </div>
    </div>
  );
}
