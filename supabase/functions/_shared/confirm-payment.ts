import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { paymentMatchesCheckout, type Transaction } from './payment-validation.ts';

export async function confirmPayment(reference: string, requestingUser?: string) {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!url || !key || !paystackKey) throw new Error('Payment service is not configured');
  const admin = createClient(url, key);
  const { data: checkout, error } = await admin.from('subscription_checkouts').select('*').eq('reference', reference).maybeSingle();
  if (error) throw error;
  if (!checkout) return { success: false, status: 'unknown_reference' };
  if (requestingUser && checkout.owner_id !== requestingUser) throw new Error('This payment belongs to another account');
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${paystackKey}` } });
  const payload = await response.json();
  if (!response.ok || !payload.status) throw new Error(`Paystack verification failed [${response.status}]: ${payload.message ?? 'Unknown error'}`);
  const transaction = payload.data as Transaction;
  if (transaction.status !== 'success') return { success: false, status: transaction.status };
  if (!paymentMatchesCheckout(transaction, checkout)) throw new Error('Payment does not match the selected subscription');
  const { data, error: activationError } = await admin.rpc('activate_subscription_checkout', {
    p_reference: reference, p_amount: transaction.amount, p_currency: transaction.currency,
    p_store_id: checkout.store_id, p_owner_id: checkout.owner_id, p_plan: checkout.plan,
    p_cycle: checkout.billing_cycle, p_paid_at: transaction.paid_at,
  });
  if (activationError) throw activationError;
  return data;
}