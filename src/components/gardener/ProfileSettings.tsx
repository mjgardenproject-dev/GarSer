import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Save, User, MapPin, Phone, Briefcase, Star, ArrowLeft } from 'lucide-react';
import { Service, GardenerProfile, PhytosanitaryPricingConfig } from '../../types';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import AddressAutocomplete from '../common/AddressAutocomplete';
import DistanceMapSelector from '../common/DistanceMapSelector';
import PalmPricingConfigurator, { PalmPricingConfig } from './PalmPricingConfigurator';
import LawnPricingConfigurator, { LawnPricingConfig } from './LawnPricingConfigurator';
import HedgePricingConfigurator, { HedgePricingConfig } from './HedgePricingConfigurator';
import TreePricingConfigurator, { TreePricingConfig } from './TreePricingConfigurator';
import TreePruningConfigurator from './TreePruningConfigurator';
import { TreePruningServiceConfig } from '../../types/treePruning';
import ShrubPricingConfigurator, { ShrubPricingConfig } from './ShrubPricingConfigurator';
import PhytosanitaryPricingConfigurator from './PhytosanitaryPricingConfigurator';
import WeedingPricingConfigurator from './WeedingPricingConfigurator';
import PhytosanitaryLicenseUpload from './PhytosanitaryLicenseUpload';
import StandardServiceConfig, { StandardPricingConfig } from './StandardServiceConfig';
import ServiceItem from './ServiceItem';
import PriceSimulator from './PriceSimulator';
import UnsavedChangesModal from '../common/UnsavedChangesModal';
import { 
  isLawnConfigValid, 
  isPalmConfigValid, 
  isHedgeConfigValid, 
  isShrubConfigValid, 
  isPhytosanitaryConfigValid,
  isWeedingConfigValid,
  WeedingPricingConfig
} from '../../utils/serviceValidation';
// import { isTreePruningConfigValid } from '../../domain/treePruning';
import { ensurePhytosanitaryPersistedConfig, normalizePhytosanitaryPricingConfig } from '../../utils/phytosanitaryConfig';

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
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(false);
  const [gardenerProfile, setGardenerProfile] = useState<GardenerProfile | null>(null);
  
  // Configurations State
  const [palmConfig, setPalmConfig] = useState<PalmPricingConfig | undefined>(undefined);
  const [lawnConfig, setLawnConfig] = useState<LawnPricingConfig | undefined>(undefined);
  const [hedgeConfig, setHedgeConfig] = useState<HedgePricingConfig | undefined>(undefined);
  const [treeConfig, setTreeConfig] = useState<TreePricingConfig | undefined>(undefined);
    const [treePruningConfig, setTreePruningConfig] = useState<TreePruningServiceConfig | undefined>(undefined);
  const [shrubConfig, setShrubConfig] = useState<ShrubPricingConfig | undefined>(undefined);
  const [phytosanitaryConfig, setPhytosanitaryConfig] = useState<PhytosanitaryPricingConfig | undefined>(undefined);
  const [weedingConfig, setWeedingConfig] = useState<WeedingPricingConfig | undefined>(undefined);
  const [standardConfigs, setStandardConfigs] = useState<Record<string, StandardPricingConfig>>({});
  const [servicePrices, setServicePrices] = useState<Record<string, number>>({}); // Base prices for standard services
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

  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<FormData>({
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

  const watchedServices = watch('services') || [];

  useEffect(() => {
    fetchServices();
    fetchGardenerProfile();
    fetchServicePrices();
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


  const fetchServicePrices = async () => {
    if (!user?.id) return;
    try {
      const { data, error } = await supabase
        .from('gardener_service_prices')
        .select('service_id, price_per_unit, additional_config')
        .eq('gardener_id', user.id);
      if (error) throw error;
      
      const prices: Record<string, number> = {};
      const configs: Record<string, StandardPricingConfig> = {};
      const saved: Record<string, any> = {};

      // Need to map service_id to service_name to store in savedConfigs by name (or by ID)
      // Since services might not be loaded yet, we'll store by ID first or wait.
      // Better to store by ID in savedConfigs to avoid name lookup issues.
      // BUT our updateDirtyState uses names because switch(service.name) is easier.
      // Let's use ID for savedConfigs to be safe, but we need service list to map ID->Name for the effect hooks?
      // Actually, let's wait for services to be loaded.
      // fetchServicePrices depends on services? No.
      // But loadConfigs DOES.
      
      // Let's store raw data and process it in loadConfigs
    } catch (e) {
      console.error('Error fetching service prices:', e);
    }
  };

  // Combined loader for configs
  useEffect(() => {
    const loadConfigs = async () => {
      if (!user?.id || services.length === 0) return;
      
      const { data } = await supabase
        .from('gardener_service_prices')
        .select('service_id, additional_config, price_per_unit')
        .eq('gardener_id', user.id);
        
      if (data) {
        const newSavedConfigs: Record<string, any> = {};
        const newPrices: Record<string, number> = {};

        data.forEach((row: any) => {
          const service = services.find(s => s.id === row.service_id);
          if (!service) return;

          newPrices[service.id] = row.price_per_unit;

          // Store saved config by Service Name for easier mapping with the effects above
          // Or keep using ID. Let's use Service Name for consistency with the switch below.
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
                  setStandardConfigs(prev => ({ ...prev, [service.id]: row.additional_config }));
                  break;
          }
        });
        setSavedConfigs(newSavedConfigs);
        setServicePrices(newPrices);
      }
    };
    loadConfigs();
  }, [user?.id, services]);

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
      const { data, error } = await supabase
        .from('gardener_profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setGardenerProfile(data);
        setValue('full_name', data.full_name);
        setValue('phone', data.phone);
        setValue('address', data.address);
        setValue('description', data.description);
        setValue('max_distance', data.max_distance);
        setValue('services', data.services || []);
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

    if (isActive) {
        // Deactivating
        // Update DB immediately
        const newServices = currentServices.filter(id => id !== serviceId);
        
        try {
            const { error } = await supabase
                .from('gardener_profiles')
                .update({ services: newServices })
                .eq('user_id', user.id);
            
            if (error) throw error;
            
            setValue('services', newServices);
            toast.success(`Servicio "${service.name}" desactivado`);
        } catch (e) {
            console.error(e);
            toast.error("Error al desactivar servicio");
        }
    } else {
        // Activating - Check Validation First
        let isValid = false;
        
        switch(service.name) {
            case 'Poda de palmeras': isValid = isPalmConfigValid(palmConfig); break;
            case 'Corte de césped': isValid = isLawnConfigValid(lawnConfig); break;
            case 'Corte de setos a máquina': isValid = isHedgeConfigValid(hedgeConfig); break;
            case 'Poda de árboles': 
                isValid = !!treePruningConfig && 
                          (treePruningConfig.formacion?.small ?? 0) > 0 && 
                          (treePruningConfig.formacion?.medium ?? 0) > 0 &&
                          (treePruningConfig.estructural?.small ?? 0) > 0 && 
                          (treePruningConfig.estructural?.medium ?? 0) > 0 &&
                          (treePruningConfig.minimumPrice ?? 0) > 0;
                break;
            case 'Poda de plantas y arbustos': isValid = isShrubConfigValid(shrubConfig); break;
            case 'Servicios fitosanitarios': isValid = isPhytosanitaryConfigValid(phytosanitaryConfig); break;
            case 'Desbroce de malas hierbas': isValid = isWeedingConfigValid(weedingConfig); break;
            default: isValid = true; // Fallback for standard
        }

        if (isValid) {
            // Update DB immediately
            const newServices = [...currentServices, serviceId];
            try {
                const { error } = await supabase
                    .from('gardener_profiles')
                    .update({ services: newServices })
                    .eq('user_id', user.id);
                
                if (error) throw error;
                
                setValue('services', newServices);
                toast.success(`Servicio "${service.name}" activado`);
            } catch (e) {
                console.error(e);
                toast.error("Error al activar servicio");
            }
        } else {
            // Invalid: Expand and show error
            // If another service is open and dirty, we might trigger the modal?
            // "Despliega la configuración automáticamente"
            checkUnsavedAndAction(serviceId, 'expand');
            toast.error(`Configuración incompleta para ${service.name}`);
        }
    }
  };

  // --- Save Logic ---

  const saveServiceConfigInternal = async (service: Service): Promise<boolean> => {
      if (!user) return false;
      
      let configToSave;
      let setConfigFunc;
      
      switch(service.name) {
        case 'Poda de palmeras': configToSave = palmConfig; setConfigFunc = setPalmConfig; break;
        case 'Corte de césped': configToSave = lawnConfig; setConfigFunc = setLawnConfig; break;
        case 'Corte de setos a máquina': configToSave = hedgeConfig; setConfigFunc = setHedgeConfig; break;
        case 'Poda de árboles': configToSave = treePruningConfig; setConfigFunc = setTreePruningConfig; break;
        case 'Poda de plantas y arbustos': configToSave = shrubConfig; setConfigFunc = setShrubConfig; break;
        case 'Servicios fitosanitarios': configToSave = ensurePhytosanitaryPersistedConfig(phytosanitaryConfig); setConfigFunc = setPhytosanitaryConfig; break;
        case 'Desbroce de malas hierbas': configToSave = weedingConfig; setConfigFunc = setWeedingConfig; break;
        default: return false;
      }

      const payload = {
        gardener_id: user.id,
        service_id: service.id,
        unit_type: (service as any).measurement || 'area',
        price_per_unit: 0, // Ignored for specialized services
        currency: 'EUR',
        active: true, // Always mark as active in prices table (doesn't mean active in profile)
        additional_config: configToSave
      };

      try {
        const { error } = await supabase.from('gardener_service_prices').upsert(payload);
        if (error) throw error;
        
        // Update Saved Configs
        setSavedConfigs(prev => ({ ...prev, [service.name]: configToSave }));
        toast.success(`Configuración guardada`);
        
        // Auto-Activate if Valid
        // Check if currently active
        const currentServices = watchedServices || [];
        if (!currentServices.includes(service.id)) {
            // Check validity again
            let isValid = false;
            switch(service.name) {
                case 'Poda de palmeras': isValid = isPalmConfigValid(configToSave as PalmPricingConfig); break;
                case 'Corte de césped': isValid = isLawnConfigValid(configToSave as LawnPricingConfig); break;
                case 'Corte de setos a máquina': isValid = isHedgeConfigValid(configToSave as HedgePricingConfig); break;
                case 'Poda de árboles': 
                isValid = !!treePruningConfig && 
                          (treePruningConfig.formacion?.small ?? 0) > 0 && 
                          (treePruningConfig.formacion?.medium ?? 0) > 0 &&
                          (treePruningConfig.estructural?.small ?? 0) > 0 && 
                          (treePruningConfig.estructural?.medium ?? 0) > 0 &&
                          (treePruningConfig.minimumPrice ?? 0) > 0;
                break;
                case 'Poda de plantas y arbustos': isValid = isShrubConfigValid(configToSave as ShrubPricingConfig); break;
                case 'Servicios fitosanitarios': isValid = isPhytosanitaryConfigValid(configToSave as PhytosanitaryPricingConfig); break;
                case 'Desbroce de malas hierbas': isValid = isWeedingConfigValid(configToSave as WeedingPricingConfig); break;
            }

            if (isValid) {
                 const newServices = [...currentServices, service.id];
                 await supabase.from('gardener_profiles').update({ services: newServices }).eq('user_id', user.id);
                 setValue('services', newServices);
                 toast.success("Servicio activado automáticamente");
            }
        }

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
          // Update local state first to ensure it matches what is being saved
           switch(serviceName) {
                case 'Poda de palmeras': setPalmConfig(config); break;
                case 'Corte de césped': setLawnConfig(config); break;
                case 'Corte de setos a máquina': setHedgeConfig(config); break;
                case 'Poda de árboles': setTreePruningConfig(config); break;
                case 'Poda de plantas y arbustos': setShrubConfig(config); break;
                case 'Desbroce de malas hierbas': setWeedingConfig(config); break;
            case 'Servicios fitosanitarios': setPhytosanitaryConfig(ensurePhytosanitaryPersistedConfig(config)); break;
           }
          // Small delay to ensure state update propagates? 
          // Actually, passing 'config' directly to save function is safer than relying on state
          // But saveServiceConfigInternal uses state.
          // Let's modify saveServiceConfigInternal to accept config optionally or just update state before calling.
          // Since React state updates are async, we should use the config passed in arg.
          
          // Re-implementing specific save logic here to use the ARGUMENT config
          if (!user) return;
          const payload = {
            gardener_id: user.id,
            service_id: service.id,
            unit_type: (service as any).measurement || 'area',
            price_per_unit: 0,
            currency: 'EUR',
            active: true,
            additional_config: serviceName === 'Servicios fitosanitarios' ? ensurePhytosanitaryPersistedConfig(config) : config
          };
          
          try {
             const { error } = await supabase.from('gardener_service_prices').upsert(payload);
             if (error) throw error;
             
             setSavedConfigs(prev => ({ ...prev, [serviceName]: payload.additional_config }));
             toast.success(`Configuración guardada`);

             // Auto activate check logic...
             const currentServices = watchedServices || [];
             if (!currentServices.includes(service.id)) {
                 let isValid = false;
                 switch(serviceName) {
                    case 'Poda de palmeras': isValid = isPalmConfigValid(config); break;
                    case 'Corte de césped': isValid = isLawnConfigValid(config); break;
                    case 'Corte de setos a máquina': isValid = isHedgeConfigValid(config); break;
                    case 'Poda de árboles': 
                isValid = !!treePruningConfig && 
                          (treePruningConfig.formacion?.small ?? 0) > 0 && 
                          (treePruningConfig.formacion?.medium ?? 0) > 0 &&
                          (treePruningConfig.estructural?.small ?? 0) > 0 && 
                          (treePruningConfig.estructural?.medium ?? 0) > 0 &&
                          (treePruningConfig.minimumPrice ?? 0) > 0;
                break;
                    case 'Poda de plantas y arbustos': isValid = isShrubConfigValid(config); break;
                    case 'Servicios fitosanitarios': isValid = isPhytosanitaryConfigValid(config); break;
                    case 'Desbroce de malas hierbas': isValid = isWeedingConfigValid(config); break;
                 }
                 if (isValid) {
                     const newServices = [...currentServices, service.id];
                     await supabase.from('gardener_profiles').update({ services: newServices }).eq('user_id', user.id);
                     setValue('services', newServices);
                     toast.success("Servicio activado automáticamente");
                 }
             }
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
        const profileData = {
            user_id: user.id,
            full_name: data.full_name,
            phone: data.phone,
            address: data.address,
            description: data.description,
            max_distance: data.max_distance,
            // We DO NOT update services list here, we preserve existing or current form state
            // But actually services are in 'data' from useForm
            services: watchedServices, // Preserve current state
            is_available: true,
            rating: gardenerProfile?.rating || 5.0,
            total_reviews: gardenerProfile?.total_reviews || 0
        };

        const { error } = await supabase.from('gardener_profiles').upsert(profileData, { onConflict: 'user_id' });
        if (error) throw error;
        
        const mainProfileData = {
            full_name: data.full_name,
            phone: data.phone,
            address: data.address
        };
        await supabase.from('profiles').update(mainProfileData).eq('user_id', user.id);
        
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
          const initialServices = gardenerProfile?.services || [];
          const aActive = initialServices.includes(a.id);
          const bActive = initialServices.includes(b.id);
          
          if (aActive && !bActive) return -1;
          if (!aActive && bActive) return 1;
          
          return a.name.localeCompare(b.name); // Keep alphabetical within groups
      });
  }, [services, gardenerProfile]);

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

      <form onSubmit={handleSubmit(onSaveProfileInfo, onError)} className="space-y-8">
        
        {/* SECTION 1: Personal Info */}
        <div className="space-y-6">
            <h3 className="text-lg font-bold text-gray-900 flex items-center border-b pb-4">
                <User className="w-5 h-5 mr-2 text-green-600" />
                Información Personal
            </h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nombre completo</label>
                    <input {...register('full_name')} type="text" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="Tu nombre completo" />
                    {errors.full_name && <p className="mt-1 text-sm text-red-600">{errors.full_name.message}</p>}
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Teléfono</label>
                    <input {...register('phone')} type="tel" className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="+34 600 000 000" />
                    {errors.phone && <p className="mt-1 text-sm text-red-600">{errors.phone.message}</p>}
                </div>
            </div>

            <div className="space-y-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Dirección base</label>
                    <AddressAutocomplete value={watch('address') || ''} onChange={(address) => setValue('address', address)} placeholder="Tu dirección de trabajo" />
                    {errors.address && <p className="mt-1 text-sm text-red-600">{errors.address.message}</p>}
                </div>
                <div>
                    <DistanceMapSelector address={watch('address') || ''} distance={watch('max_distance') || 25} onDistanceChange={(d) => setValue('max_distance', d)} />
                    {errors.max_distance && <p className="mt-1 text-sm text-red-600">{errors.max_distance.message}</p>}
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Descripción profesional</label>
                <textarea {...register('description')} rows={4} className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="Describe tu experiencia..." />
                {errors.description && <p className="mt-1 text-sm text-red-600">{errors.description.message}</p>}
            </div>

            <button type="submit" disabled={loading} className="w-full md:w-auto px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 font-semibold flex items-center justify-center">
                <Save className="w-5 h-5 mr-2" />
                {loading ? 'Guardando...' : 'Guardar Información Personal'}
            </button>
        </div>

        {/* SECTION 1.5: Phytosanitary License */}
        <PhytosanitaryLicenseUpload onStatusChange={setLicenseStatus} />

        {/* SECTION 2: Services */}
        <div className="space-y-4">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
                <Briefcase className="w-5 h-5 mr-2 text-green-600" />
                Servicios que ofreces
            </h3>
            
            <div className="grid grid-cols-1 gap-4">
                {sortedServices.map(service => {
                    const isSelected = watchedServices.includes(service.id);
                    const isExpanded = expandedServiceId === service.id;
                    
                    return (
                        <ServiceItem
                            key={service.id}
                            service={service}
                            isActive={isSelected}
                            isExpanded={isExpanded}
                            hasError={false} // We handle error toast/expansion on interaction, not persistent state yet
                            onToggle={() => handleToggleService(service.id)}
                            onExpand={() => handleExpand(service.id)}
                        >
                            {/* Render Configurator based on Name */}
                            {service.name === 'Poda de palmeras' && (
                                <PalmPricingConfigurator 
                                    value={palmConfig} 
                                    initialConfig={savedConfigs['Poda de palmeras']}
                                    onChange={setPalmConfig} 
                                    onSave={(c) => handleWrapperSave('Poda de palmeras', c)} 
                                />
                            )}
                            {service.name === 'Corte de césped' && (
                                <LawnPricingConfigurator 
                                    value={lawnConfig} 
                                    initialConfig={savedConfigs['Corte de césped']}
                                    onChange={setLawnConfig} 
                                    onSave={(c) => handleWrapperSave('Corte de césped', c)} 
                                />
                            )}
                            {service.name === 'Corte de setos a máquina' && (
                                <HedgePricingConfigurator 
                                    value={hedgeConfig} 
                                    initialConfig={savedConfigs['Corte de setos a máquina']}
                                    onChange={setHedgeConfig} 
                                    onSave={(c) => handleWrapperSave('Corte de setos a máquina', c)} 
                                />
                            )}
                            {service.name === 'Poda de árboles' && (
                                <TreePruningConfigurator
                                  value={treePruningConfig}
                                  initialConfig={savedConfigs['Poda de árboles']}
                                  onChange={setTreePruningConfig}
                                  onSave={(c) => handleWrapperSave('Poda de árboles', c)}
                                />
                            )}
                            {service.name === 'Poda de plantas y arbustos' && (
                                <ShrubPricingConfigurator 
                                    value={shrubConfig} 
                                    initialConfig={savedConfigs['Poda de plantas y arbustos']}
                                    onChange={setShrubConfig} 
                                    onSave={(c) => handleWrapperSave('Poda de plantas y arbustos', c)} 
                                />
                            )}
                            {service.name === 'Servicios fitosanitarios' && (
                                <PhytosanitaryPricingConfigurator 
                                    value={phytosanitaryConfig} 
                                    initialConfig={savedConfigs['Servicios fitosanitarios']}
                                    onChange={setPhytosanitaryConfig} 
                                    onSave={(c: PhytosanitaryPricingConfig) => handleWrapperSave('Servicios fitosanitarios', c)}
                                    licenseStatus={licenseStatus} 
                                />
                            )}
                            {service.name === 'Desbroce de malas hierbas' && (
                                <WeedingPricingConfigurator 
                                    value={weedingConfig} 
                                    initialConfig={savedConfigs['Desbroce de malas hierbas']}
                                    onChange={setWeedingConfig} 
                                    onSave={(c: WeedingPricingConfig) => handleWrapperSave('Desbroce de malas hierbas', c)}
                                    licenseStatus={licenseStatus} 
                                />
                            )}
                        </ServiceItem>
                    );
                })}
            </div>
        </div>

      </form>

      <div className="mt-8">
        <PriceSimulator
          services={sortedServices}
          configs={{
            palmConfig,
            lawnConfig,
            hedgeConfig,
            treeConfig,
            shrubConfig,
            phytosanitaryConfig,
            weedingConfig
          }}
        />
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
