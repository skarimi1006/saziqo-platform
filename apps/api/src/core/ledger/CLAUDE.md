# Ledger Invariant

Wallet.balance MUST equal sum(CREDIT.amount) - sum(DEBIT.amount) for that wallet.
Direct mutation of Wallet.balance outside the LedgerService is FORBIDDEN.
The reconciliation job (Phase 9E) verifies this nightly.

The `ledger_entries` table is append-only — UPDATE and DELETE are blocked by
database-level triggers (migration 20260501150000_ledger_append_only).
All writes must go through LedgerService methods which use $transaction +
SELECT ... FOR UPDATE to serialize concurrent operations on the same wallet.
