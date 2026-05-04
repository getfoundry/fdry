import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { fetchVaultOnChain, VaultOnChainInfo } from "../lib/vaults";

export type VaultInfoState = {
  info: VaultOnChainInfo | null;
  loading: boolean;
  error: string | null;
  updatedAt: number;
};

export function useVaultInfo(vaultPubkey: string, refreshMs = 20_000): VaultInfoState {
  const { connection } = useConnection();
  const [state, setState] = useState<VaultInfoState>({
    info: null,
    loading: true,
    error: null,
    updatedAt: 0,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const info = await fetchVaultOnChain(connection, vaultPubkey);
        if (!alive) return;
        setState({ info, loading: false, error: null, updatedAt: Date.now() });
      } catch (e) {
        if (!alive) return;
        setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
      }
    };
    load();
    const id = setInterval(load, refreshMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [connection, vaultPubkey, refreshMs]);

  return state;
}
