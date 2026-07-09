# Critique

## Round 1: Interface Ownership

Decision: keep approve-inbox-specific commands under `workflow inboxtask`.

Reason: all consumers are inbox-task adjacent: inbox, detail, actions, iForm/patch approvals, and intelligent audit result attached to a workflow task. Keeping them under `workflow inboxtask` avoids overloading the existing `workflow task` namespace while preserving `workflow task batch-approve/batch-reject` for the existing batch commands.

## Round 2: Safety

Decision: mark business writes as `dangerous: true`.

Reason: approve/reject/save changes business state. This matches the bip-cli skill and lets model callers show the raw command and key parameters before execution. iuap-apcom-myapproval backend appends `--yes` only after its existing UI/API approval request.

## Round 3: Regression Risk

Decision: keep approve-inbox REST contracts unchanged and add a direct-fetch guard.

Reason: most user-facing behavior lives behind local `/api/*`. The riskiest regression is silently leaving a new direct YonBIP fetch path behind; a guard test makes that visible.

## Gate Result

The user explicitly requested implementation of the accepted plan. Treat this as approval to pass the product-dev-flow human gate and implement.
