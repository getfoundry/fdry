export function VaultExplainerCard() {
  return (
    <section className="rounded-3xl border-2 border-line bg-soft p-6 md:p-8 mb-10">
      <div className="text-xs font-mono text-ember uppercase tracking-wider mb-4">
        // first read
      </div>

      <div className="grid md:grid-cols-2 gap-6 md:gap-8">
        <div>
          <h3 className="font-display text-xl md:text-2xl font-bold mb-3 lowercase">
            stFDRY is your share of the vault.
          </h3>
          <p className="text-sm md:text-base text-muted leading-relaxed">
            Depositing FDRY mints stFDRY, a proportional claim on whatever the
            vault holds. The live holdings table shows the vault asset account,
            token balance, and NAV directly from Solana reads. That means your
            withdrawal depends on the vault state at the moment you burn stFDRY,
            not on a fixed conversion promise. Read stFDRY as a share of live
            NAV, not as a yield token.
          </p>
        </div>

        <div>
          <h3 className="font-display text-xl md:text-2xl font-bold mb-3 lowercase">
            exploratory work can move NAV either way.
          </h3>
          <p className="text-sm md:text-base text-muted leading-relaxed">
            The activity log and Solscan links show what the vault did, and the
            strategy panel separates paper state from live state. That evidence
            makes the work inspectable, but it does not make it safe. Bad
            routing, slippage, market moves, or protocol risk can reduce NAV,
            so the right expectation is visibility rather than gains.
          </p>
        </div>
      </div>

      <div className="mt-6 pt-6 border-t border-line">
        <h3 className="font-display text-xl md:text-2xl font-bold mb-3 lowercase">
          the fee is tied to realized profit only.
        </h3>
        <p className="text-sm md:text-base text-muted leading-relaxed max-w-3xl">
          The operator cut is 0.69% of realized profits only. If there is no
          realized profit, there is no profit cut; if NAV falls, holders absorb
          the loss pro-rata through their stFDRY share. This makes the fee rule
          clear without promising that profit will exist. The page should be
          judged by public evidence, not by a gain claim.
        </p>
      </div>

      <div className="mt-6 pt-5 border-t border-line text-xs font-mono text-muted lowercase leading-relaxed space-y-1">
        <div>
          // mint stFDRY - vault receives FDRY - NAV per stFDRY = vault NAV /
          stFDRY supply
        </div>
        <div>
          // burn stFDRY - redeem your pro-rata share at current NAV, subject
          to Voltr program rules.
        </div>
      </div>
    </section>
  );
}
