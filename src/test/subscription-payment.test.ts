import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS, getSubscriptionPrice } from '../../supabase/functions/_shared/subscription-plans';
import { paymentMatchesCheckout, allowedCallback } from '../../supabase/functions/_shared/payment-validation';

describe('subscription access and payments', () => {
  it('Business includes three stores', () => expect(PLAN_LIMITS.business.stores).toBe(3));
  it('Business includes three staff per store, excluding the owner', () => expect(PLAN_LIMITS.business.staffPerStore).toBe(3));
  it('Biz Pro includes five stores and ten staff per store', () => expect(PLAN_LIMITS.biz_pro).toEqual({ stores: 5, staffPerStore: 10 }));
  it.each([['monthly', 45000], ['six_months', 270000], ['yearly', 450000]])('Biz Pro %s costs %i', (cycle, amount) => expect(getSubscriptionPrice('biz_pro', cycle)).toBe(amount));
  const checkout = { reference: 'lantid-test', amount: 3000000, store_id: 'store-1', owner_id: 'owner-1', plan: 'business', billing_cycle: 'monthly' };
  const paid = { reference: 'lantid-test', status: 'success', amount: 3000000, currency: 'NGN', paid_at: '2026-11-21T22:21:00Z', metadata: { store_id: 'store-1', user_id: 'owner-1', plan: 'business', billing_cycle: 'monthly' } };
  it('accepts a fully matching payment', () => expect(paymentMatchesCheckout(paid, checkout)).toBe(true));
  it.each([{ amount: 100 }, { currency: 'USD' }, { status: 'abandoned' }, { reference: 'other' }, { paid_at: 'invalid' }, { metadata: { ...paid.metadata, user_id: 'other' } }, { metadata: { ...paid.metadata, plan: 'biz_pro' } }, { metadata: { ...paid.metadata, billing_cycle: 'yearly' } }])('rejects mismatched or unpaid transactions %o', change => expect(paymentMatchesCheckout({ ...paid, ...change }, checkout)).toBe(false));
  it('accepts the subscription return URL only on app origins', () => {
    expect(allowedCallback('https://lantid.store/subscription')).toBe(true);
    expect(allowedCallback('https://attacker.example/subscription')).toBe(false);
    expect(allowedCallback('https://lantid.store/other')).toBe(false);
  });
});