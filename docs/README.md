# FDRY Quant Alpha Vault — Docs

Design and implementation docs for the FDRY-entry quant rotation vault on Symmetry.

## Start here

| Document | Purpose |
|---|---|
| [SPEC.md](./SPEC.md) | Full product spec. Architecture, vault config, flows, risks, decisions. |
| [SHIP.md](./SHIP.md) | Day-by-day checklist from pre-flight to public launch. |
| [SYMMETRY.md](./SYMMETRY.md) | Symmetry protocol reference — SDK calls, roles, fees. |

## Key facts

- **Venue:** Symmetry V3 (mainnet, permissionless), Program ID `BASKT7aKd8n7ibpUbwLP3Wiyxyi3yoiXsxBk4Hpumate`
- **Entry token:** FDRY (via frontend Jupiter wrapper — not held inside vault)
- **Trading base:** SOL, across 8-token memecoin universe
- **Cadence:** Daily rebalance, driven by bible-EBM signal
- **Fee:** 2% annual creator fee
- **Pattern:** Option A (frontend-only 2-tx deposit/withdraw), no custom contract in v1
- **Status:** Pre-launch, Phase 0 (oracle verification + pool bootstrap)

## Non-goals (v1)

- Lock FDRY — this architecture cycles FDRY, does not lock it
- Generate meaningful fee income — $400/year expected at v1 AUM scale
- Performance fees — disabled at Symmetry protocol level
- Personal profitability — v1 is about mechanism validation and public track record

## File layout (to be created during implementation)

```
fdry/
├── docs/
│   ├── README.md        (this file)
│   ├── SPEC.md
│   ├── SHIP.md
│   ├── SYMMETRY.md
│   ├── oracles.json     (Phase 0.1 output — oracle pubkeys per token)
│   ├── pool.json        (Phase 0.2 output — Meteora pool metadata)
│   └── vault.json       (Phase 1.2 output — mainnet vault pubkey + keys)
├── frontend/            (Phase 2)
├── bot/                 (Phase 3)
└── runs/
    └── spec_final_backtest/   (Phase 0.3 output)
```
