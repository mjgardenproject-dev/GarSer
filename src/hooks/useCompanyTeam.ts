import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { PhytoLicenseRenewal, PhytoLicenseStatus } from '../shared/phytoLicense';

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
  /** Estado real del carnet (uno vigente manda aunque haya un renovado en revisión). */
  license_status: PhytoLicenseStatus | null;
  has_valid_phyto_license: boolean;
  license_expires_at?: string | null;
  license_rejection_reason?: string | null;
  license_renewal?: PhytoLicenseRenewal | null;
  /** Cuándo le pidió la empresa el carnet por última vez. */
  license_requested_at?: string | null;
  /** R-04: tiene horario fijo (al menos una franja semanal). */
  has_recurring_schedule?: boolean;
  /** R-04: horario fijo y al menos un servicio: ya puede recibir trabajos. */
  is_configured?: boolean;
}

export interface TeamInvitation { id: string; email: string; created_at: string; expires_at: string }

export interface CompanyTeamOverview {
  company: { id: string; legal_name: string | null; tax_id: string | null; status: string; assignment_mode: 'auto' | 'manual'; allow_split_jobs: boolean; max_crew?: number; commercial_name: string; phone: string | null; address: string | null };
  offered_services: TeamService[];
  /** Hace algo que pide carnet: fitosanitarios o desbroce con herbicida. */
  offers_chemical?: boolean;
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
