import { describe, expect, it } from 'vitest';
import { getSubscriptionExpiry, getSubscriptionPrice } from '../../supabase/functions/_shared/subscription-plans';

describe('subscription pricing in NGN', () => {
  it.each([
    ['starter', 'monthly', 15000],
    ['starter', 'six_months', 60000],
    ['starter', 'yearly', 120000],
    ['business', 'monthly', 30000],
    ['business', 'six_months', 180000],
    ['business', 'yearly', 300000],
  ])('%s %s costs %i', (plan, cycle, amount) => {
    expect(getSubscriptionPrice(plan, cycle)).toBe(amount);
    expect(Number(getSubscriptionPrice(plan, cycle)) * 100).toBe(amount * 100);
  });
  it('activates six months of access', () => {
    expect(getSubscriptionExpiry(new Date('2026-11-11T06:08:00Z'), 'six_months').toISOString()).toBe('2027-05-11T06:08:00.000Z');
  });
  it('clamps six-month expiry to the final day of the month', () => {
    expect(getSubscriptionExpiry(new Date('2026-08-31T06:08:00Z'), 'six_months').toISOString()).toBe('2027-02-28T06:08:00.000Z');
  });
  it('does not invent six-month Enterprise pricing', () => {
    expect(getSubscriptionPrice('enterprise', 'six_months')).toBeUndefined();
  });
  it('rejects unsupported plans and billing cycles', () => {
    expect(getSubscriptionPrice('invalid', 'monthly')).toBeUndefined();
    expect(getSubscriptionPrice('starter', 'invalid')).toBeUndefined();
  });
});