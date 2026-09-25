import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAccount } from '../contexts/AccountContext';

// En qué punto del alta está una cuenta de empresa (GarSer Empresas, F3).
//
// Aprobada = pertenece a una empresa (my_company_id(), que solo existe tras la aprobación del
// admin). Si no, manda la última solicitud. Una cuenta que no es de empresa no tiene alta.

export type CompanyOnboardingStage = 'not_company' | 'none' | 'draft' | 'submitted' | 'rejected' | 'approved';

export interface CompanyApplicationRow {
  id: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  review_comment: string | null;
  [key: string]: unknown;
}

export interface CompanyOnboarding {
  loading: boolean;
  stage: CompanyOnboardingStage;
  application: CompanyApplicationRow | null;
  companyId: string | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export function stageFromData(companyId: string | null, application: CompanyApplicationRow | null): CompanyOnboardingStage {
  if (companyId) return 'approved';
  if (!application) return 'none';
  // Aprobada sin empresa no debería darse (la aprobación crea ambas en la misma transacción):
  // si pasara, se trata como enviada — el usuario ve «en revisión», nunca un panel roto.
  if (application.status === 'approved') return 'submitted';
  return application.status;
}

export function useCompanyOnboarding(): CompanyOnboarding {
  const { user } = useAuth();
  const { role, loading: accountLoading } = useAccount();
  const [state, setState] = useState<Omit<CompanyOnboarding, 'refresh'>>({
    loading: true, stage: 'none', application: null, companyId: null, error: null,
  });
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (accountLoading) return;
    if (!user?.id || role !== 'company') {
      setState({ loading: false, stage: 'not_company', application: null, companyId: null, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [{ data: companyId, error: companyError }, { data: apps, error: appError }] = await Promise.all([
        supabase.rpc('my_company_id'),
        supabase
          .from('company_applications')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1),
      ]);
      if (companyError) throw companyError;
      if (appError) throw appError;
      if (mine !== seq.current) return;
      const application = ((apps as CompanyApplicationRow[] | null) ?? [])[0] ?? null;
      const id = (companyId as string | null) ?? null;
      setState({ loading: false, stage: stageFromData(id, application), application, companyId: id, error: null });
    } catch (error) {
      if (mine !== seq.current) return;
      console.error('Error cargando el alta de la empresa:', error);
      setState((s) => ({ ...s, loading: false, error: 'No hemos podido cargar el estado de tu solicitud.' }));
    }
  }, [user?.id, role, accountLoading]);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, loading: state.loading || accountLoading, refresh: load };
}
