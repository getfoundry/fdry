# fdry-gate

> **PLACEHOLDER CRATE — DO NOT DEPLOY**

**What it is:** a seed of a chain-layer mint-guard wrapper intended to enforce
the FDRY-only invariant on Symmetry deposits.

**What it is NOT:**
- Not runnable — `declare_id!` is a placeholder.
- Not audited.
- Not anchored — no CPI into Symmetry is wired; no `Anchor.toml` scaffolding.
- `rust-toolchain.toml` does not unblock the platform-tools BPF `rustc`.

**Graduation conditions:** this crate becomes real code only after Lewis
commits to Vessel B (a custom Anchor vault OR a deployed wrapper) as the
FDRY-only mechanism.

**Per Step-8 Judgement audit:** the placeholder `declare_id`, missing CPI,
porous account constraints, and tautological tests are all known. Do not
extend this crate further until the Vessel choice is made.
