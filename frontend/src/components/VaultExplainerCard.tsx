/**
 * VaultExplainerCard — first-read primer for new visitors.
 *
 * Two PEEL paragraphs stacked: "what stFDRY is" + "what to expect".
 * Sits above the data panels so a first-time viewer reads it before they
 * try to interpret the equity chart or deposit widget.
 *
 * Public-tier copy: no internal jargon (no Smyrna/Laodicea/medoid/Kelly).
 * Honest about: volatility, single-fire blow-through, capital provision
 * mechanic, not-yield framing.
 */
export function VaultExplainerCard() {
  return (
    <section className="rounded-3xl border-2 border-line bg-soft p-6 md:p-8 mb-10">
      <div className="text-xs font-mono text-ember uppercase tracking-wider mb-4">
        // first read
      </div>

      <div className="grid md:grid-cols-2 gap-6 md:gap-8">
        <div>
          <h3 className="font-display text-xl md:text-2xl font-bold mb-3 lowercase">
            stFDRY is your share of a trading fund.
          </h3>
          <p className="text-sm md:text-base text-muted leading-relaxed">
            Depositing FDRY mints stFDRY, a proportional claim on the vault.
            The vault spends that FDRY buying short-window underdog tokens,
            holds each position for up to 8 hours, then closes back to FDRY.
            In a 40-day, 168-fire replay, 76% of fires won; the single worst
            fire was -55% of the deployed slice and the best was +286%. Wins
            grow the vault's FDRY balance, losses shrink it, and NAV per
            stFDRY moves with that directly. This is risk capital provision,
            not a yield product.
          </p>
        </div>

        <div>
          <h3 className="font-display text-xl md:text-2xl font-bold mb-3 lowercase">
            NAV per stFDRY is volatile by design.
          </h3>
          <p className="text-sm md:text-base text-muted leading-relaxed">
            When the strategy goes live, up to 30% of vault FDRY can be in a
            single underdog token at any moment; 70% sits idle and stays
            instant-redeemable. Even with the cap, a bad fire on the
            deployed slice can show as a 5-15% NAV swing inside a single
            4-hour bar. You can withdraw at any time, but the price you get
            is whatever NAV is at the moment of withdrawal.
          </p>
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-line">
        <h3 className="font-display text-xl md:text-2xl font-bold mb-3 lowercase">
          FDRY itself moves because the vault keeps swapping in and out of it.
        </h3>
        <p className="text-sm md:text-base text-muted leading-relaxed max-w-3xl">
          Every fire is a round-trip: FDRY → underdog → FDRY, on a 4-hour
          cadence with up to 30% of the vault deployed at once. FDRY's pool
          sees buy and sell pressure several times a day, and thin liquidity
          amplifies the move. Anyone holding FDRY directly feels the
          strategy's swaps on the spot price; stFDRY NAV volatility is on
          top of that, not separate from it. There is no passive position
          near this vault.
        </p>
      </div>

      <div className="mt-6 pt-5 border-t border-line text-xs font-mono text-muted lowercase leading-relaxed space-y-1">
        <div>
          // mint stFDRY → vault holds your FDRY → strategy spends it on
          underdog tokens → closes back to FDRY → NAV per stFDRY = vault FDRY
          ÷ stFDRY supply
        </div>
        <div>
          // burn stFDRY → redeem your pro-rata FDRY at current NAV. No
          lockup. The operator cannot block withdrawals at the contract
          level.
        </div>
      </div>
    </section>
  );
}
