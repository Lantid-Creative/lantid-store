import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Store } from 'lucide-react';
import { toast } from 'sonner';
import { z } from 'zod';

const detailsSchema = z.object({ name: z.string().trim().min(1).max(100), address: z.string().trim().min(1).max(255), phone: z.string().trim().max(40) });

export function StoreSwitcher() {
  const { stores, storeId, role, switchStore, refreshStores, entitlement } = useAuth();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const owned = stores.filter(store => store.role === 'owner');
  const createStore = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = detailsSchema.safeParse({ name, address, phone });
    if (!parsed.success) { toast.error('Enter a store name and address within the allowed lengths.'); return; }
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_owned_store', { p_name: parsed.data.name, p_address: parsed.data.address, p_phone: parsed.data.phone });
      if (error) throw error;
      if (data) await refreshStores(data);
      setOpen(false); setName(''); setAddress(''); setPhone('');
      toast.success('Store created');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Could not create store'); }
    finally { setSaving(false); }
  };
  return <div className="p-2 border-b border-sidebar-border space-y-2">
    <Select value={storeId ?? undefined} onValueChange={id => void switchStore(id)}>
      <SelectTrigger aria-label="Switch store" className="w-full bg-sidebar text-sidebar-foreground border-sidebar-border"><SelectValue placeholder="Select store" /></SelectTrigger>
      <SelectContent>{stores.map(store => <SelectItem key={store.id} value={store.id}>{store.name}</SelectItem>)}</SelectContent>
    </Select>
    {role === 'owner' && <Button size="sm" variant="ghost" className="w-full justify-start text-sidebar-foreground" disabled={owned.length >= (entitlement?.stores ?? 1)} onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" />Add Store</Button>}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogHeader><DialogTitle className="flex gap-2 items-center"><Store className="h-5 w-5" />Add Store</DialogTitle></DialogHeader>
      <form onSubmit={createStore} className="space-y-4">
        <label className="block text-sm space-y-1">Store Name<Input value={name} onChange={e => setName(e.target.value)} required maxLength={100} /></label>
        <label className="block text-sm space-y-1">Store Address<Input value={address} onChange={e => setAddress(e.target.value)} required maxLength={255} /></label>
        <label className="block text-sm space-y-1">Store Phone<Input value={phone} onChange={e => setPhone(e.target.value)} maxLength={40} /></label>
        <Button type="submit" disabled={saving} className="w-full">{saving ? 'Creating…' : 'Create Store'}</Button>
      </form>
    </DialogContent></Dialog>
  </div>;
}