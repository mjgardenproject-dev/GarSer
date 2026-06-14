import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useForm, FormProvider } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { User, ArrowLeft } from 'lucide-react';
import {
  Service,
  GardenerProfile,
  LawnPricingConfig,
  HedgePricingConfig,
  PalmPricingConfig,
  ShrubPricingConfig,
  PhytosanitaryPricingConfig,
  WeedingPricingConfig,
} from '../../types';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { TreePruningServiceConfig } from '../../types/treePruning';
import UnsavedChangesModal from '../common/UnsavedChangesModal';
import ProfileSidebar from './profile-tabs/ProfileSidebar';
import PersonalTab from './profile-tabs/PersonalTab';
import CoverageTab from './profile-tabs/CoverageTab';
import ServicesTab from './profile-tabs/ServicesTab';
import { 
  isLawnConfigValid, 
  isHedgeConfigValid, 
  isPalmConfigValid, 
  isTreePruningConfigValid, 
  isShrubConfigValid, 
  isPhytosanitaryConfigValid, 
  isWeedingConfigValid 
} from '../../utils/serviceValidation';
// import { isTreePruningConfigValid } from '../../domain/treePruning';
import { ensurePhytosanitaryPersistedConfig, normalizePhytosanitaryPricingConfig } from '../../utils/phytosanitaryConfig';
import { getCoordinatesFromAddress } from '../../utils/geolocation';

// Sólo permitir los servicios definidos en el estimador IA (coincidencia estricta de nombre)
const ALLOWED_SERVICE_NAMES = [
  'Corte de césped',
  'Poda de plantas y arbustos',
  'Corte de setos a máquina',
  'Poda de árboles',
  'Servicios fitosanitarios',
  'Poda de palmeras',
  'Desbroce de malas hierbas'
];
const normalizeText = (s: string) => (s || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();
const ALLOWED_NORMALIZED = ALLOWED_SERVICE_NAMES.map(normalizeText);
const toCanonicalServiceName = (name?: string) => {
  const n = normalizeText(name || '');
  if (!n) return name || '';
  if (n.includes('fitosanit') || n.includes('fumig')) return 'Servicios fitosanitarios';
  // Attempt to map correctly based on ALLOWED_SERVICE_NAMES for perfect casing
  const match = ALLOWED_SERVICE_NAMES.find(a => normalizeText(a) === n);
  return match || name || '';
};
const isAllowedServiceName = (name?: string) => {
  const n = normalizeText(name || '');
  if (!n) return false;
  if (n.includes('fitosanit') || n.includes('fumig')) return true;
  return ALLOWED_NORMALIZED.includes(n);
};

const schema = yup.object({
  full_name: yup.string().required('Nombre completo requerido'),
  phone: yup.string().required('Teléfono requerido'),
  address: yup.string().required('Dirección requerida'),
  description: yup.string().required('Descripción requerida'),
  max_distance: yup.number().min(1, 'Mínimo 1 km').max(100, 'Máximo 100 km').required('Distancia requerida'),
  services: yup.array() // We keep this for form state, but validation is handled per-service
});

type FormData = yup.InferType<typeof schema>;

interface ProfileSettingsProps {
  onBack?: () => void;
}

const ProfileSettings: React.FC<ProfileSettingsProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'monolith';

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [gardenerProfile, setGardenerProfile] = useState<GardenerProfile | null>(null);
  
  // Configurations State
  const [palmConfig, setPalmConfig] = useState<PalmPricingConfig | undefined>(undefined);
  const [lawnConfig, setLawnConfig] = useState<LawnPricingConfig | undefined>(undefined);
  const [hedgeConfig, setHedgeConfig] = useState<HedgePricingConfig | undefined>(undefined);
  const [treePruningConfig, setTreePruningConfig] = useState<TreePruningServiceConfig | undefined>(undefined);
  const [shrubConfig, setShrubConfig] = useState<ShrubPricingConfig | undefined>(undefined);
  const [phytosanitaryConfig, setPhytosanitaryConfig] = useState<PhytosanitaryPricingConfig | undefined>(undefined);
  const [weedingConfig, setWeedingConfig] = useState<WeedingPricingConfig | undefined>(undefined);
  const [licenseStatus, setLicenseStatus] = useState<'pending' | 'approved' | 'rejected' | null>(null);

  // Refactor State
  const [expandedServiceId, setExpandedServiceId] = useState<string | null>(() => {
      // Try to restore from local storage if available
      return localStorage.getItem('gardener_profile_expanded_service') || null;
  });
  const [savedConfigs, setSavedConfigs] = useState<Record<string, any>>({});
  const [dirtyServices, setDirtyServices] = useState<Record<string, boolean>>({});
  const [isRestoringScroll, setIsRestoringScroll] = useState(() => {
    // Start true only if we have a saved position
    return !!localStorage.getItem('gardener_profile_scroll_pos');
  });
  
  // Persist expanded service ID
  useEffect(() => {
    if (expandedServiceId) {
        localStorage.setItem('gardener_profile_expanded_service', expandedServiceId);
    } else {
        localStorage.removeItem('gardener_profile_expanded_service');
    }
  }, [expandedServiceId]);

  // Scroll Restoration Logic
  useEffect(() => {
      const handleScroll = () => {
          if (isRestoringScroll) return;
          localStorage.setItem('gardener_profile_scroll_pos', window.scrollY.toString());
      };

      // Debounce scroll event slightly to avoid excessive writes
      let timeoutId: any;
      const debouncedScroll = () => {
          clearTimeout(timeoutId);
          timeoutId = setTimeout(handleScroll, 100);
      };

      window.addEventListener('scroll', debouncedScroll);
      return () => {
          window.removeEventListener('scroll', debouncedScroll);
          clearTimeout(timeoutId);
      };
  }, [isRestoringScroll]);

  // Restore scroll position after services are loaded
  useEffect(() => {
      if (services.length > 0) {
          const savedScroll = localStorage.getItem('gardener_profile_scroll_pos');
          if (savedScroll) {
              const scrollPos = parseInt(savedScroll, 10);
              
              if (scrollPos === 0) {
                  setIsRestoringScroll(false);
                  return;
              }

              // Wait for render cycle to stabilize height
              setTimeout(() => {
                  if (Math.abs(window.scrollY - scrollPos) > 10) {
                      window.scrollTo({
                          top: scrollPos,
                          behavior: 'auto' // Instant jump, no smooth scroll
                      });
                  }
                  // Mark restoration as done
                  setIsRestoringScroll(false);
              }, 100); 
              
              // A second attempt for slower renders (e.g. images or sub-components)
              setTimeout(() => {
                  if (Math.abs(window.scrollY - scrollPos) > 10) {
                      window.scrollTo({ top: scrollPos, behavior: 'auto' });
                  }
                  // Ensure visibility eventually
                  setIsRestoringScroll(false);
              }, 500);
          } else {
              setIsRestoringScroll(false);
          }
      }
  }, [services]);

  // Modal State
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    pendingServiceId: string | null; // The service user wanted to open/close
    action: 'expand' | 'collapse' | 'toggle';
  }>({ isOpen: false, pendingServiceId: null, action: 'collapse' });

  const methods = useForm<FormData>({
    resolver: yupResolver(schema) as any,
    defaultValues: {
      full_name: '',
      phone: '',
      address: '',
      description: '',
      max_distance: 25,
      services: []
    }
  });

  const { handleSubmit, setValue, watch } = methods;

  const watchedServices = watch('services') || [];

  useEffect(() => {
    fetchServices();
    fetchGardenerProfile();
  }, [user]);

  // Deep comparison helper (simple JSON based for this use case)
  const isDifferent = (obj1: any, obj2: any) => {
    return JSON.stringify(obj1) !== JSON.stringify(obj2);
  };

  const updateDirtyState = (serviceName: string, currentConfig: any) => {
    // Find saved config for this service
    const saved = savedConfigs[serviceName];
    // If no saved config (new service setup), compare with undefined or empty default
    const isDirty = isDifferent(currentConfig, saved);
    
    setDirtyServices(prev => ({
        ...prev,
        [serviceName]: isDirty
    }));
  };

  // Effect to track dirty state when configs change
  // We need to map service Name to the config state variable
  useEffect(() => {
     updateDirtyState('Poda de palmeras', palmConfig);
  }, [palmConfig, savedConfigs]);

  useEffect(() => {
      updateDirtyState('Corte de césped', lawnConfig);
  }, [lawnConfig, savedConfigs]);

  useEffect(() => {
      updateDirtyState('Corte de setos a máquina', hedgeConfig);
  }, [hedgeConfig, savedConfigs]);
  
  useEffect(() => {
      updateDirtyState('Poda de árboles', treePruningConfig);
  }, [treePruningConfig, savedConfigs]);

  useEffect(() => {
      updateDirtyState('Poda de plantas y arbustos', shrubConfig);
  }, [shrubConfig, savedConfigs]);

  useEffect(() => {
      updateDirtyState('Servicios fitosanitarios', phytosanitaryConfig);
  }, [phytosanitaryConfig, savedConfigs]);

  useEffect(() => {
      updateDirtyState('Desbroce de malas hierbas', weedingConfig);
  }, [weedingConfig, savedConfigs]);

  const normalizeServiceConfig = (serviceName: string, config: unknown) => {
    if (serviceName === 'Servicios fitosanitarios') {
      return ensurePhytosanitaryPersistedConfig(config as PhytosanitaryPricingConfig | undefined);
    }
    return config;
  };

  const getServiceConfig = useCallback((service: Service, overrideConfig?: unknown) => {
    if (overrideConfig !== undefined) {
      return normalizeServiceConfig(service.name, overrideConfig);
    }

    switch (service.name) {
      case 'Poda de palmeras':
        return palmConfig;
      case 'Corte de césped':
        return lawnConfig;
      case 'Corte de setos a máquina':
        return hedgeConfig;
      case 'Poda de árboles':
        return treePruningConfig;
      case 'Poda de plantas y arbustos':
        return shrubConfig;
      case 'Servicios fitosanitarios':
        return ensurePhytosanitaryPersistedConfig(phytosanitaryConfig);
      case 'Desbroce de malas hierbas':
        return weedingConfig;
      default:
        return undefined;
    }
  }, [hedgeConfig, lawnConfig, palmConfig, phytosanitaryConfig, shrubConfig, treePruningConfig, weedingConfig]);

  const isServiceConfigValid = useCallback((service: Service, configOverride?: unknown) => {
    const config = getServiceConfig(service, configOverride);

    switch (service.name) {
      case 'Poda de palmeras':
        return isPalmConfigValid(config as PalmPricingConfig | undefined);
      case 'Corte de césped':
        return isLawnConfigValid(config as LawnPricingConfig | undefined);
      case 'Corte de setos a máquina':
        return isHedgeConfigValid(config as HedgePricingConfig | undefined);
      case 'Poda de árboles':
        return isTreePruningConfigValid(config as TreePruningServiceConfig | undefined);
      case 'Poda de plantas y arbustos':
        return isShrubConfigValid(config as ShrubPricingConfig | undefined);
      case 'Servicios fitosanitarios':
        return isPhytosanitaryConfigValid(config as PhytosanitaryPricingConfig | undefined);
      case 'Desbroce de malas hierbas':
        return isWeedingConfigValid(config as WeedingPricingConfig | undefined);
      default:
        return false;
    }
  }, [getServiceConfig]);

  const buildServicePricePayload = useCallback((service: Service, active: boolean, overrideConfig?: unknown) => ({
    gardener_id: user?.id,
    service_id: service.id,
    unit_type: (service as any).measurement || 'area',
    price_per_unit: 0,
    currency: 'EUR',
    active,
    additional_config: getServiceConfig(service, overrideConfig),
  }), [getServiceConfig, user?.id]);

  const syncLegacyServicesProjection = useCallback(async (nextServices: string[]) => {
    if (!user?.id) return false;

    const { error } = await (supabase.from('gardener_profiles') as any)
      .update({ services: nextServices })
      .eq('user_id', user.id);

    if (error) {
      throw error;
    }

    setGardenerProfile((prev) => (prev ? { ...prev, services: nextServices } : prev));
    setValue('services', nextServices);
    return true;
  }, [setValue, user?.id]);

  const persistGardenerProfile = useCallback(async (profileData: Record<string, unknown>) => {
    if (!user?.id) {
      throw new Error('No hay usuario autenticado para guardar el perfil.');
    }

    const { user_id: _ignoredUserId, ...updatePayload } = profileData;

    const { data: updatedProfile, error: updateError } = await (supabase.from('gardener_profiles') as any)
      .update(updatePayload)
      .eq('user_id', user.id)
      .select('user_id')
      .maybeSingle();

    if (updateError) {
      throw updateError;
    }

    if (updatedProfile) {
      return updatedProfile;
    }

    const { data: insertedProfile, error: insertError } = await (supabase.from('gardener_profiles') as any)
      .insert(profileData)
      .select('user_id')
      .single();

    if (insertError) {
      throw insertError;
    }

    return insertedProfile;
  }, [user?.id]);

  // Combined loader for configs
  useEffect(() => {
    const loadConfigs = async () => {
      if (!user?.id || services.length === 0) return;
      
      const { data } = await supabase
        .from('gardener_service_prices')
        .select('service_id, additional_config, active')
        .eq('gardener_id', user.id);
        
      if (data) {
        const newSavedConfigs: Record<string, any> = {};
        const activeServiceIds: string[] = [];

        data.forEach((row: any) => {
          const service = services.find(s => s.id === row.service_id);
          if (!service) return;
          if (row.active === true) {
            activeServiceIds.push(service.id);
          }

          if (service.name === 'Servicios fitosanitarios') {
            const normalized = normalizePhytosanitaryPricingConfig(row.additional_config as PhytosanitaryPricingConfig | undefined);
            const persisted = ensurePhytosanitaryPersistedConfig(normalized);
            newSavedConfigs[service.name] = persisted;
            setPhytosanitaryConfig(persisted);
            return;
          }

          newSavedConfigs[service.name] = row.additional_config;
          if (!row.additional_config) return;
          switch(service.name) {
              case 'Poda de palmeras': setPalmConfig(row.additional_config as PalmPricingConfig); break;
              case 'Corte de césped': setLawnConfig(row.additional_config as LawnPricingConfig); break;
              case 'Corte de setos a máquina': setHedgeConfig(row.additional_config as HedgePricingConfig); break;
              case 'Poda de árboles': setTreePruningConfig(row.additional_config as TreePruningServiceConfig); break;
              case 'Poda de plantas y arbustos': setShrubConfig(row.additional_config as ShrubPricingConfig); break;
              case 'Desbroce de malas hierbas': setWeedingConfig(row.additional_config as WeedingPricingConfig); break;
              default:
                  break;
          }
        });
        setSavedConfigs(newSavedConfigs);
        setValue('services', activeServiceIds);
      }
    };
    loadConfigs();
  }, [services, setValue, user?.id]);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .order('name');

      if (error) throw error;
      const all = data || [];
      const filtered = all
        .map((s: Service) => ({ ...s, name: toCanonicalServiceName(s.name) }))
        .filter((s: Service) => isAllowedServiceName(s.name));
      setServices(filtered);
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  const fetchGardenerProfile = async () => {
    if (!user) return;
    try {
      const { data, error } = await (supabase.from('gardener_profiles') as any)
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        const profile = data as GardenerProfile;
        setGardenerProfile(profile);
        setValue('full_name', profile.full_name);
        setValue('phone', profile.phone);
        setValue('address', profile.address);
        setValue('description', profile.description);
        setValue('max_distance', profile.max_distance);
      }
    } catch (error) {
      console.error('Error fetching gardener profile:', error);
    }
  };

  // --- Accordion Logic ---

  const handleExpand = (serviceId: string) => {
    // If clicking the already expanded service, collapse it
    if (expandedServiceId === serviceId) {
        checkUnsavedAndAction(null, 'collapse');
    } else {
        // Switching to another service
        checkUnsavedAndAction(serviceId, 'expand');
    }
  };

  const checkUnsavedAndAction = (targetServiceId: string | null, action: 'expand' | 'collapse' | 'toggle') => {
    // Identify currently expanded service
    if (!expandedServiceId) {
        // Nothing open, safe to proceed
        if (action === 'expand' && targetServiceId) setExpandedServiceId(targetServiceId);
        if (action === 'collapse') setExpandedServiceId(null);
        return;
    }

    const currentService = services.find(s => s.id === expandedServiceId);
    if (!currentService) {
        setExpandedServiceId(targetServiceId);
        return;
    }

    // Check if dirty
    const isDirty = dirtyServices[currentService.name];

    if (isDirty) {
        setModalState({
            isOpen: true,
            pendingServiceId: targetServiceId,
            action
        });
    } else {
        // Safe to switch
        setExpandedServiceId(targetServiceId);
    }
  };

  const handleModalSave = async () => {
      // Find the currently expanded service (the one we are closing)
      if (!expandedServiceId) return;
      const service = services.find(s => s.id === expandedServiceId);
      if (!service) return;

      // Trigger save for that service
      // We need a mapping to call the specific save function
      // Or we can manually call the save logic here since we have the state
      const success = await saveServiceConfigInternal(service);
      
      if (success) {
          closeModalAndProceed();
      }
  };

  const handleModalDiscard = () => {
      // Revert changes for currently expanded service
      if (expandedServiceId) {
          const service = services.find(s => s.id === expandedServiceId);
          if (service) {
              const saved = savedConfigs[service.name];
              // Restore state
              switch(service.name) {
                case 'Poda de palmeras': setPalmConfig(saved); break;
                case 'Corte de césped': setLawnConfig(saved); break;
                case 'Corte de setos a máquina': setHedgeConfig(saved); break;
                case 'Poda de árboles': setTreePruningConfig(saved); break;
                case 'Poda de plantas y arbustos': setShrubConfig(saved); break;
                case 'Servicios fitosanitarios': setPhytosanitaryConfig(ensurePhytosanitaryPersistedConfig(saved)); break;
                case 'Desbroce de malas hierbas': setWeedingConfig(saved); break;
              }
          }
      }
      closeModalAndProceed();
  };

  const closeModalAndProceed = () => {
      setExpandedServiceId(modalState.pendingServiceId);
      setModalState({ isOpen: false, pendingServiceId: null, action: 'collapse' });
  };

  // --- Toggle Logic ---

  const handleToggleService = async (serviceId: string) => {
    const currentServices = watchedServices || [];
    const isActive = currentServices.includes(serviceId);
    const service = services.find(s => s.id === serviceId);
    
    if (!service || !user) return;

    if (!isActive && !isServiceConfigValid(service)) {
      checkUnsavedAndAction(serviceId, 'expand');
      toast.error(`Configuración incompleta para ${service.name}`);
      return;
    }

    const nextServices = isActive
      ? currentServices.filter(id => id !== serviceId)
      : [...currentServices, serviceId];

    try {
      const payload = buildServicePricePayload(service, !isActive);
      const { error } = await (supabase.from('gardener_service_prices') as any).upsert(payload, {
        onConflict: 'gardener_id,service_id',
      });
      if (error) throw error;

      await syncLegacyServicesProjection(nextServices);
      setSavedConfigs((prev) => ({
        ...prev,
        [service.name]: payload.additional_config,
      }));
      toast.success(`Servicio "${service.name}" ${isActive ? 'desactivado' : 'activado'}`);
    } catch (e) {
      console.error(e);
      toast.error(`Error al ${isActive ? 'desactivar' : 'activar'} servicio`);
    }
  };

  // --- Save Logic ---

  const saveServiceConfigInternal = async (service: Service): Promise<boolean> => {
      if (!user) return false;
      const isActive = watchedServices.includes(service.id);
      const payload = buildServicePricePayload(service, isActive);

      try {
        const { error } = await (supabase.from('gardener_service_prices') as any).upsert(payload, {
          onConflict: 'gardener_id,service_id',
        });
        if (error) throw error;
        
        setSavedConfigs(prev => ({ ...prev, [service.name]: payload.additional_config }));
        toast.success(isActive ? 'Configuración guardada y servicio sincronizado' : 'Configuración guardada');
        return true;
      } catch (error) {
        console.error(`Error saving ${service.name}:`, error);
        toast.error(`Error al guardar`);
        return false;
      }
  };

  const handleWrapperSave = async (serviceName: string, config: any) => {
      const service = services.find(s => s.name === serviceName);
      if (service) {
           switch(serviceName) {
                case 'Poda de palmeras': setPalmConfig(config); break;
                case 'Corte de césped': setLawnConfig(config); break;
                case 'Corte de setos a máquina': setHedgeConfig(config); break;
                case 'Poda de árboles': setTreePruningConfig(config); break;
                case 'Poda de plantas y arbustos': setShrubConfig(config); break;
                case 'Desbroce de malas hierbas': setWeedingConfig(config); break;
            case 'Servicios fitosanitarios': setPhytosanitaryConfig(ensurePhytosanitaryPersistedConfig(config)); break;
           }

          if (!user) return;
          const isActive = watchedServices.includes(service.id);
          const payload = buildServicePricePayload(service, isActive, config);
          
          try {
             const { error } = await (supabase.from('gardener_service_prices') as any).upsert(payload, {
               onConflict: 'gardener_id,service_id',
             });
             if (error) throw error;
             
             setSavedConfigs(prev => ({ ...prev, [serviceName]: payload.additional_config }));
             toast.success(isActive ? 'Configuración guardada y servicio sincronizado' : 'Configuración guardada');
          } catch(e) {
              console.error(e);
              toast.error("Error al guardar");
          }
      }
  };

  // --- Profile Info Save ---

  const onError = (errors: any) => {
    toast.error('Por favor, completa todos los campos requeridos marcados en rojo.');
    console.log('Validation errors:', errors);
  };

  const onSaveProfileInfo = async (data: any) => {
    if (!user) return;
    setLoading(true);
    try {
        const normalizedAddress = String(data.address || '').trim();
        const shouldRefreshCoordinates =
          normalizedAddress !== String(gardenerProfile?.address || '').trim()
          || !Number.isFinite(Number(gardenerProfile?.operational_latitude))
          || !Number.isFinite(Number(gardenerProfile?.operational_longitude));

        const resolvedCoordinates = shouldRefreshCoordinates
          ? await getCoordinatesFromAddress(normalizedAddress)
          : {
              lat: Number(gardenerProfile?.operational_latitude),
              lng: Number(gardenerProfile?.operational_longitude),
            };

        if (!resolvedCoordinates) {
            toast.error('No se pudo validar la dirección base en el mapa. Selecciona una dirección sugerida válida antes de guardar.');
            return;
        }

        const profileData = {
            user_id: user.id,
            full_name: data.full_name,
            phone: data.phone,
            address: normalizedAddress,
            description: data.description,
            max_distance: data.max_distance,
            operational_latitude: resolvedCoordinates.lat,
            operational_longitude: resolvedCoordinates.lng,
            // We DO NOT update services list here, we preserve existing or current form state
            // But actually services are in 'data' from useForm
            services: watchedServices, // Preserve current state
            is_available: true,
            rating: gardenerProfile?.rating || 5.0,
            total_reviews: gardenerProfile?.total_reviews || 0
        };

        await persistGardenerProfile(profileData);
        
        const mainProfileData = {
            full_name: data.full_name,
            phone: data.phone,
            address: normalizedAddress
        };
        await (supabase.from('profiles') as any).update(mainProfileData).eq('user_id', user.id);
        
        toast.success("Información personal guardada");
        fetchGardenerProfile();
    } catch (e: any) {
        console.error(e);
        toast.error("Error al guardar perfil");
    } finally {
        setLoading(false);
    }
  };

  // Sort services: Active first, then inactive
  // We use useMemo with gardenerProfile dependency to ensure sorting only happens on load/refresh
  // and NOT when user toggles checkboxes (watchedServices changes).
  const sortedServices = useMemo(() => {
      return [...services].sort((a, b) => {
          const aActive = watchedServices.includes(a.id);
          const bActive = watchedServices.includes(b.id);
          
          if (aActive && !bActive) return -1;
          if (!aActive && bActive) return 1;
          
          return a.name.localeCompare(b.name); // Keep alphabetical within groups
      });
  }, [services, watchedServices]);

  const handleTabChange = (tab: string) => {
    setSearchParams({ tab });
  };

  const personalInitialData = useMemo(() => ({
    full_name: gardenerProfile?.full_name || '',
    phone: gardenerProfile?.phone || '',
    description: gardenerProfile?.description || ''
  }), [gardenerProfile?.full_name, gardenerProfile?.phone, gardenerProfile?.description]);

  const coverageInitialData = useMemo(() => ({
    address: gardenerProfile?.address || '',
    max_distance: gardenerProfile?.max_distance || 25
  }), [gardenerProfile?.address, gardenerProfile?.max_distance]);

  return (
    <div 
        className="max-w-full sm:max-w-3xl md:max-w-4xl mx-auto px-2.5 py-4 sm:p-6 lg:px-6 transition-opacity duration-300"
        style={{ opacity: isRestoringScroll ? 0 : 1 }}
    >
      {onBack && (
        <button
          onClick={onBack}
          className="mb-6 inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg shadow-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al Panel
        </button>
      )}
      
      <div className="flex items-center justify-between mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 flex items-center">
          <User className="w-6 h-6 sm:w-8 sm:h-8 mr-3 text-green-600" />
          Configuración del Perfil
        </h2>
      </div>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Sidebar Navigation */}
        <div className="md:w-64 flex-shrink-0">
          <ProfileSidebar activeTab={activeTab} onTabChange={handleTabChange} />
        </div>

        {/* Tab Content Area */}
        <div className="flex-1 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <FormProvider {...methods}>
            <form onSubmit={handleSubmit(onSaveProfileInfo, onError)}>
              {/* Monolith view or specific tabs */}
              {(activeTab === 'monolith' || activeTab === 'personal') && (
                <div className={activeTab === 'monolith' ? 'mb-12' : ''}>
                  <PersonalTab 
                    loading={loading} 
                    setLicenseStatus={setLicenseStatus}
                    initialData={personalInitialData}
                    onSave={onSaveProfileInfo}
                  />
                </div>
              )}

              {(activeTab === 'monolith' || activeTab === 'coverage') && (
                <div className={activeTab === 'monolith' ? 'mb-12' : ''}>
                  <CoverageTab 
                    loading={loading} 
                    initialData={coverageInitialData}
                    hasOperationalCoordinates={
                      Number.isFinite(Number(gardenerProfile?.operational_latitude))
                      && Number.isFinite(Number(gardenerProfile?.operational_longitude))
                    }
                    onSave={onSaveProfileInfo}
                  />
                </div>
              )}

              {(activeTab === 'monolith' || activeTab === 'services') && (
                <div>
                  <ServicesTab 
                    sortedServices={sortedServices}
                    watchedServices={watchedServices}
                    expandedServiceId={expandedServiceId}
                    handleToggleService={handleToggleService}
                    handleExpand={handleExpand}
                    handleWrapperSave={handleWrapperSave}
                    configs={{
                      palmConfig,
                      lawnConfig,
                      hedgeConfig,
                      treePruningConfig,
                      shrubConfig,
                      phytosanitaryConfig,
                      weedingConfig
                    }}
                    setConfigs={{
                      setPalmConfig,
                      setLawnConfig,
                      setHedgeConfig,
                      setTreePruningConfig,
                      setShrubConfig,
                      setPhytosanitaryConfig,
                      setWeedingConfig
                    }}
                    savedConfigs={savedConfigs}
                    licenseStatus={licenseStatus}
                  />
                </div>
              )}
            </form>
          </FormProvider>
        </div>
      </div>

      <UnsavedChangesModal 
        isOpen={modalState.isOpen}
        serviceName={services.find(s => s.id === expandedServiceId)?.name || 'Servicio'}
        onSave={handleModalSave}
        onDiscard={handleModalDiscard}
        onCancel={() => setModalState({ isOpen: false, pendingServiceId: null, action: 'collapse' })}
      />
    </div>
  );
};

export default ProfileSettings;
