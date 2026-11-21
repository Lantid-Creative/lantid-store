import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { z } from "npm:zod@3";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Staff service not configured');
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    // Verify the calling user is authenticated and is an owner
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || '', {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: { user: callingUser }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !callingUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const schema = z.object({ email: z.string().email().max(255).optional(), full_name: z.string().trim().min(1).max(100), role: z.enum(['cashier','manager']), store_id: z.string().uuid(), action: z.enum(['update']).optional(), user_id: z.string().uuid().optional(), role_id: z.string().uuid().optional() });
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return new Response(JSON.stringify({ error: 'Invalid staff details' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const body = parsed.data;
    const { email, full_name, role, store_id, action, user_id, role_id } = body;

    // Verify caller is owner of this store
    const { data: callerRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', callingUser.id)
      .eq('store_id', store_id)
      .single();

    if (!callerRole || callerRole.role !== 'owner') {
      return new Response(JSON.stringify({ error: 'Only store owners can manage staff accounts' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Handle UPDATE action
    if (action === 'update') {
      if (!user_id || !role_id) {
        return new Response(JSON.stringify({ error: 'Missing user_id or role_id' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const { data: target } = await supabaseAdmin.from('user_roles').select('role').eq('id', role_id).eq('store_id', store_id).eq('user_id', user_id).maybeSingle();
      if (!target || target.role === 'owner') throw new Error('Staff member not found in this store');
      // Update profile name
      await supabaseAdmin
        .from('profiles')
        .update({ full_name })
        .eq('user_id', user_id);

      // Update role
      const { error: roleUpdateError } = await supabaseAdmin
        .from('user_roles')
        .update({ role })
        .eq('id', role_id)
        .eq('store_id', store_id);

      if (roleUpdateError) {
        return new Response(JSON.stringify({ error: roleUpdateError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ success: true, message: 'Staff updated!' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!email) return new Response(JSON.stringify({ error: 'Email is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    const { data: entitlement, error: entitlementError } = await supabaseAdmin.rpc('owner_entitlement', { p_owner_id: callingUser.id });
    if (entitlementError) throw entitlementError;
    const { count, error: countError } = await supabaseAdmin.from('user_roles').select('id', { count: 'exact', head: true }).eq('store_id', store_id).neq('role', 'owner');
    if (countError) throw countError;
    if (!entitlement.active || (count ?? 0) >= entitlement.staff) return new Response(JSON.stringify({ error: 'Staff limit reached for this store. Upgrade your plan to add staff.' }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    // Check if user already exists
    let existingUser;
    for (let page = 1; ; page++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      existingUser = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (existingUser || data.users.length < 1000) break;
    }

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;

      // Check if they already have a role in this store
      const { data: existingRole } = await supabaseAdmin
        .from('user_roles')
        .select('id')
        .eq('user_id', userId)
        .eq('store_id', store_id)
        .maybeSingle();

      if (existingRole) {
        return new Response(JSON.stringify({ error: 'This user is already a staff member in your store' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    } else {
      // Create the user account
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: `${new URL(req.headers.get('Origin') || 'https://lantid.store').origin}/profile` });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      userId = newUser.user.id;
    }

    // Existing memberships and profile details must not be overwritten when adding another store.
    if (!existingUser) {
      const { error } = await supabaseAdmin.from('profiles').update({ full_name, store_id }).eq('user_id', userId);
      if (error) throw error;
    }

    // Assign role
    const { error: roleError } = await supabaseAdmin
      .from('user_roles')
      .insert({ user_id: userId, store_id, role });

    if (roleError) {
      return new Response(JSON.stringify({ error: roleError.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      user: { id: userId, email, full_name, role },
      message: existingUser 
        ? `Existing user added as ${role}. They can log in with their current password.`
        : `Staff invitation sent. They can set their own password from the email.`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
