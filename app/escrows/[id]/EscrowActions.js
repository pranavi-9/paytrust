'use client';

// OWNED BY MEMBER A. The escrow detail page (Member B) renders this
// component; Member A fills it in with the Fund / Mark complete / Release /
// Refund buttons that call the routes in docs/api-ledger.md.
//
// Props:
//   escrow: { id, status, amount }   amount is a string like "2500.00"
//   role:   'buyer' | 'seller' | 'admin'
//
// After a successful action, call router.refresh() (from next/navigation)
// so the page reloads the status and history.

export default function EscrowActions({ escrow, role }) {
  return null;
}
