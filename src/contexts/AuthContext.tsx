import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';

type AppRole = 'owner' | 'manager' | 'cashier';
type StoreMembership = { id: string; name: string; role: AppRole };
type Entitlement = { active: boolean; plan: string; stores: number; staff: number; is_trialing?: boolean; trial_ends_at?: string; expires_at?: string };

interface AuthContextType {
  user: User | null;
  profile: { full_name: string; store_id: string | null; lifetime_access: boolean } | null;
  role: AppRole | null;
  storeId: string | null;
  stores: StoreMembership[];
  entitlement: Entitlement | null;
  switchStore: (id: string) => Promise<void>;
  refreshStores: (preferredId?: string) => Promise<void>;
  loading: boolean;
  subscriptionActive: boolean;
  trialEndsAt: Date | null;
  isTrialing: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refetchSubscription: () => Promise<void>;
  refetchProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [stores, setStores] = useState<StoreMembership[]>([]);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<{ full_name: string; store_id: string | null; lifetime_access: boolean } | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscriptionActive, setSubscriptionActive] = useState(false);
  const [trialEndsAt, setTrialEndsAt] = useState<Date | null>(null);
  const [isTrialing, setIsTrialing] = useState(false);

  const checkSubscriptionStatus = async (stId: string, hasLifetimeAccess: boolean) => {
    const { data, error } = await supabase.rpc('get_store_entitlement', { p_store_id: stId });
    if (error) throw error;
    const access = data as unknown as Entitlement;
    setEntitlement(access);
    setSubscriptionActive(access.active || hasLifetimeAccess);
    setIsTrialing(!!access.is_trialing && !hasLifetimeAccess);
    setTrialEndsAt(access.trial_ends_at ? new Date(access.trial_ends_at) : null);
  };

  const refetchSubscription = async () => {
    if (storeId) {
      await checkSubscriptionStatus(storeId, profile?.lifetime_access ?? false);
    }
  };

  const refetchProfile = async () => {
    if (!user) return;
    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, store_id, lifetime_access')
      .eq('user_id', user.id)
      .single();
    if (profileData) setProfile(profileData);
  };

  const fetchUserData = async (userId: string) => {
    // Get profile
    const { data: profileData } = await supabase
      .from('profiles')
      .select('full_name, store_id, lifetime_access')
      .eq('user_id', userId)
      .single();

    if (profileData) {
      setProfile(profileData);
    }

    const { data: roleRows, error: rolesError } = await supabase
      .from('user_roles')
      .select('role, store_id')
      .eq('user_id', userId);
    if (rolesError) throw rolesError;
    const ids = (roleRows ?? []).map(row => row.store_id);
    const { data: storeRows, error: storesError } = ids.length ? await supabase.from('stores').select('id, name').in('id', ids) : { data: [], error: null };
    if (storesError) throw storesError;
    const memberships: StoreMembership[] = (storeRows ?? []).flatMap(store => {
      const membership = roleRows?.find(row => row.store_id === store.id);
      return membership ? [{ ...store, role: membership.role as AppRole }] : [];
    });
    setStores(memberships);
    const selected = memberships.find(store => store.id === profileData?.store_id) ?? memberships[0];
    if (selected) {
      setRole(selected.role);
      setStoreId(selected.id);
      await checkSubscriptionStatus(selected.id, profileData?.lifetime_access ?? false);
    } else {
      setRole(null);
      setStoreId(null);
      setSubscriptionActive(false);
      setIsTrialing(false);
    }
  };

  const switchStore = async (id: string) => {
    const selected = stores.find(store => store.id === id);
    if (!selected || !user || id === storeId) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('profiles').update({ store_id: id }).eq('user_id', user.id);
      if (error) throw error;
      await queryClient.cancelQueries();
      queryClient.clear();
      setStoreId(id); setRole(selected.role);
      setProfile(previous => previous ? { ...previous, store_id: id } : previous);
      await checkSubscriptionStatus(id, profile?.lifetime_access ?? false);
    } finally { setLoading(false); }
  };
  const refreshStores = async (_preferredId?: string) => {
    if (!user) return;
    setLoading(true);
    try { await queryClient.cancelQueries(); queryClient.clear(); await fetchUserData(user.id); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    let mounted = true;
    let currentUserId: string | null = null;

    const loadUserData = async (sessionUser: User | null) => {
      if (!mounted) return;

      if (!sessionUser) {
        currentUserId = null;
        setUser(null);
        setProfile(null);
        setRole(null);
        setStoreId(null);
        setStores([]);
        setEntitlement(null);
        queryClient.clear();
        setSubscriptionActive(false);
        setIsTrialing(false);
        setTrialEndsAt(null);
        setLoading(false);
        return;
      }

      // Prevent duplicate loads for the same user
      if (currentUserId === sessionUser.id) return;
      currentUserId = sessionUser.id;

      setLoading(true);
      setUser(sessionUser);

      try {
        await fetchUserData(sessionUser.id);
      } catch (error) {
        console.error('Could not load account:', error);
        setSubscriptionActive(false);
      } finally {
        if (mounted) setLoading(false);
      }
    };

    // Listen for auth changes — handle INITIAL_SESSION + SIGNED_IN
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        loadUserData(null);
      } else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        loadUserData(session?.user ?? null);
      } else if (event === 'TOKEN_REFRESHED' && session?.user) {
        setUser(session.user);
      }
    });

    // Fallback for session pickup if INITIAL_SESSION was missed
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (mounted && !currentUserId) {
        loadUserData(session?.user ?? null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  };

  const signUp = async (email: string, password: string, fullName: string, phone?: string) => {
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone } }
    });

    if (!error && data.user && phone) {
      await supabase
        .from('profiles')
        .update({ phone: phone.trim() })
        .eq('user_id', data.user.id);
    }

    return { error: error?.message || null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{
      user, profile, role, storeId, loading, stores, entitlement, switchStore, refreshStores,
      subscriptionActive, trialEndsAt, isTrialing,
      signIn, signUp, signOut, refetchSubscription, refetchProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
