import { useState, type ReactNode } from "react";

export function DepositGate({ children }: { children: ReactNode }) {
  const KEY = "fdry:risk-ack:v1";
  const [acked, setAcked] = useState<boolean>(() => {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  const [checked, setChecked] = useState(false);

  if (acked) return <>{children}</>;

  const accept = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* storage can be unavailable */
    }
    setAcked(true);
  };

  return (
    <div className="rounded-3xl border-2 border-ember/40 bg-sunrise/40 p-6 md:p-8">
      <div className="text-xs font-mono text-ember uppercase tracking-wider mb-3">// read before deposit</div>
      <h3 className="font-display text-xl font-bold mb-3 lowercase">the vault is discretionary working capital</h3>
      <div className="text-sm text-ink/80 leading-relaxed space-y-3 font-mono mb-5">
        <p>
          The operator can use vault assets for trading, infrastructure, model training, contractors, legal work, or other operating costs. There is no guaranteed strategy, no guaranteed yield, and no approved-use whitelist.
        </p>
        <p>
          If treasury activity works, NAV per share can rise. If trading, spending, or market prices move against the vault, NAV per share can fall. Your claim is pro-rata to whatever the vault holds when you withdraw.
        </p>
        <p>
          Every move should be visible through the vault page and Solscan. Transparency is not safety; it only gives you the evidence needed to decide whether to stay exposed.
        </p>
      </div>
      <label className="flex items-start gap-3 cursor-pointer mb-4 select-none">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1 w-4 h-4 accent-ember cursor-pointer"
        />
        <span className="text-sm font-mono text-ink">
          I understand the operator has discretion, NAV can go down, and this is experimental.
        </span>
      </label>
      <button
        onClick={accept}
        disabled={!checked}
        className="w-full px-4 py-3 rounded-xl bg-molten text-white font-mono text-sm hover:opacity-95 transition disabled:opacity-40 disabled:cursor-not-allowed"
      >
        [ show deposit widget ]
      </button>
      <p className="text-xs text-muted mt-3 font-mono text-center">
        Nothing is submitted here. Full disclosure stays on the <a href="/vault" className="text-ember hover:underline">vault page</a>.
      </p>
    </div>
  );
}
