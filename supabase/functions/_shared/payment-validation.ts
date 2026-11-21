export type Checkout = { reference: string; amount: number; store_id: string; owner_id: string; plan: string; billing_cycle: string };
export type Transaction = { reference: string; status: string; amount: number; currency: string; paid_at: string; metadata?: { store_id?: string; user_id?: string; plan?: string; billing_cycle?: string } };
export function paymentMatchesCheckout(transaction: Transaction, checkout: Checkout) {
  return transaction.status === 'success' && transaction.reference === checkout.reference &&
    transaction.amount === checkout.amount && transaction.currency === 'NGN' &&
    transaction.metadata?.store_id === checkout.store_id && transaction.metadata?.user_id === checkout.owner_id &&
    transaction.metadata?.plan === checkout.plan && transaction.metadata?.billing_cycle === checkout.billing_cycle &&
    Number.isFinite(Date.parse(transaction.paid_at));
}
export function allowedCallback(url: string) {
  try {
    const parsed = new URL(url);
    const origins = ['http://localhost:8080', 'https://lantid.store', 'https://www.lantid.store', 'https://pack-and-pour-pos.lovable.app', 'https://id-preview--169f138e-9145-4def-a79d-81f1def4e63b.lovable.app'];
    return origins.includes(parsed.origin) && parsed.pathname === '/subscription' && !parsed.username && !parsed.password;
  } catch { return false; }
}