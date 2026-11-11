# Architecture rules
- Use the shared subscription catalog in `supabase/functions/_shared/subscription-plans.ts` for displayed prices, checkout amounts, and billing durations to prevent client/payment drift.
- Store membership is validated by database roles; switching stores clears query caches and remounts store-scoped pages to prevent cart/data leakage.
- Subscriptions cover all stores owned by the paying owner; database triggers enforce store/staff limits and service-only activation validates immutable checkout records.