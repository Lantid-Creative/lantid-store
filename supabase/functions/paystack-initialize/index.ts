import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSubscriptionPrice } from '../_shared/subscription-plans.ts';
import { allowedCallback } from '../_shared/payment-validation.ts';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { z } from 'npm:zod@3';

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = claimsData.claims.sub;
    const userEmail = claimsData.claims.email;

    const parsed = z.object({ plan: z.enum(['starter','business','biz_pro','enterprise']), store_id: z.string().uuid(), callback_url: z.string().url(), billing_cycle: z.enum(['monthly','six_months','yearly']).default('monthly') }).safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: 'Invalid subscription details' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { plan, store_id, callback_url, billing_cycle } = parsed.data;
    if (!allowedCallback(callback_url)) return new Response(JSON.stringify({ error: 'Invalid payment return address' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: store } = await supabase.from('stores').select('owner_id').eq('id', store_id).maybeSingle();
    if (!store || store.owner_id !== userId) return new Response(JSON.stringify({ error: 'Only owners can pay for their stores' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    if (!plan || !store_id || !callback_url) {
      return new Response(JSON.stringify({ error: "Missing required fields: plan, store_id, callback_url" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const price = getSubscriptionPrice(plan, billing_cycle);
    if (price === undefined) {
      return new Response(JSON.stringify({ error: "Invalid plan or billing cycle" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const cycle = billing_cycle;
    const amount = price * 100;

    const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!PAYSTACK_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Paystack not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const reference = `lantid-${crypto.randomUUID()}`;
    const adminClient = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    const { error: checkoutError } = await adminClient.from('subscription_checkouts').insert({ store_id, owner_id: userId, plan, billing_cycle: cycle, amount, reference });
    if (checkoutError) throw checkoutError;

    // Initialize Paystack transaction
    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: userEmail,
        amount,
        currency: "NGN",
        reference,
        callback_url,
        metadata: {
          store_id,
          plan,
          user_id: userId,
          billing_cycle: cycle,
        },
      }),
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      throw new Error(`Paystack init failed [${paystackRes.status}]: ${JSON.stringify(paystackData)}`);
    }

    return new Response(
      JSON.stringify({
        authorization_url: paystackData.data.authorization_url,
        reference,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Error initializing payment:", error);
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
