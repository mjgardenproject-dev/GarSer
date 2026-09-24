import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// Equipo de la empresa del dueño con sesión, en una sola llamada (company_team_overview,
// GarSer Empresas F3.3). Solo el dueño puede pedirlo: el servidor lo rechaza para cualquier otro.

export interface TeamService { id: string; name: string }

export interface TeamMember {
  member_id: string;
  user_id: string;
  role: 'owner' | 'manager' | 'employee';
  status: 'active' | 'inactive';
  counts_as_labour: boolean;
  joined_at: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  services: TeamService[];
  license_status: 'pending' | 'approved' | 'rejected' | 'expired' | null;
  has_valid_phyto_license: boolean;
}

export interface TeamInvitation { id: string; email: string; created_at: string; expires_at: string }

export interface CompanyTeamOverview {
  company: { id: string; legal_name: string | null; tax_id: string | null; status: string; assignment_mode: 'auto' | 'manual'; allow_split_jobs: boolean; commercial_name: string; phone: string | null; address: string | null };
  offered_services: TeamService[];
  members: TeamMember[];
  invitations: TeamInvitation[];
}

export const PHYTO_SERVICE_NAME = 'Servicios fitosanitarios';

export function useCompanyTeam() {
  const [data, setData] = useState<CompanyTeamOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    const { data: overview, error: rpcError } = await supabase.rpc('company_team_overview');
    if (mine !== seq.current) return;
    if (rpcError) {
      setError(rpcError.message || 'No hemos podido cargar tu equipo.');
    } else {
      setData(overview as unknown as CompanyTeamOverview);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  return { data, loading, error, refresh: load };
}
