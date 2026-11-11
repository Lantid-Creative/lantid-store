export type BillingCycle = 'monthly' | 'six_months' | 'yearly';

// Prices are NGN; Paystack expects kobo.
export const SUBSCRIPTION_PRICES = {
  starter: { monthly: 15000, six_months: 60000, yearly: 120000 },
  business: { monthly: 30000, six_months: 180000, yearly: 300000 },
  enterprise: { monthly: 50000, yearly: 480000 },
} as const;

export function getSubscriptionPrice(plan: string, cycle: string): number | undefined {
  const prices = Object.entries(SUBSCRIPTION_PRICES).find(([id]) => id === plan)?.[1];
  return prices ? Object.entries(prices).find(([id]) => id === cycle)?.[1] : undefined;
}

export function getSubscriptionExpiry(start: Date, cycle: string): Date {
  const expiry = new Date(start);
  if (cycle === 'six_months') {
    const day = expiry.getUTCDate();
    expiry.setUTCDate(1);
    expiry.setUTCMonth(expiry.getUTCMonth() + 6);
    const lastDay = new Date(Date.UTC(expiry.getUTCFullYear(), expiry.getUTCMonth() + 1, 0)).getUTCDate();
    expiry.setUTCDate(Math.min(day, lastDay));
  } else {
    // Preserve existing monthly and yearly subscription durations.
    expiry.setUTCDate(expiry.getUTCDate() + (cycle === 'yearly' ? 365 : 30));
  }
  return expiry;
}