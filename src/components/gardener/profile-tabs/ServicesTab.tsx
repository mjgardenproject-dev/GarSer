import React, { useState } from 'react';
import { Briefcase } from 'lucide-react';
import ServiceItem from '../ServiceItem';
import SlideOver from '../../common/SlideOver';
import PalmPricingConfigurator, { PalmPricingConfig } from '../PalmPricingConfigurator';
import LawnPricingConfigurator, { LawnPricingConfig } from '../LawnPricingConfigurator';
import HedgePricingConfigurator, { HedgePricingConfig } from '../HedgePricingConfigurator';
import TreePruningConfigurator from '../TreePruningConfigurator';
import { TreePruningServiceConfig } from '../../../types/treePruning';
import ShrubPricingConfigurator, { ShrubPricingConfig } from '../ShrubPricingConfigurator';
import PhytosanitaryPricingConfigurator, { PhytosanitaryPricingConfig } from '../PhytosanitaryPricingConfigurator';
import WeedingPricingConfigurator, { WeedingPricingConfig } from '../WeedingPricingConfigurator';

interface ServicesTabProps {
  sortedServices: any[];
  watchedServices: string[];
  expandedServiceId: string | null;
  handleToggleService: (id: string) => void;
  handleExpand: (id: string) => void;
  handleWrapperSave: (name: string, config: any) => void;
  configs: {
    palmConfig: any;
    lawnConfig: any;
    hedgeConfig: any;
    treePruningConfig: any;
    shrubConfig: any;
    phytosanitaryConfig: any;
    weedingConfig: any;
  };
  setConfigs: {
    setPalmConfig: any;
    setLawnConfig: any;
    setHedgeConfig: any;
    setTreePruningConfig: any;
    setShrubConfig: any;
    setPhytosanitaryConfig: any;
    setWeedingConfig: any;
  };
  savedConfigs: any;
  licenseStatus: 'pending' | 'approved' | 'rejected' | null;
}

const ServicesTab: React.FC<ServicesTabProps> = ({
  sortedServices,
  watchedServices,
  expandedServiceId,
  handleToggleService,
  handleExpand,
  handleWrapperSave,
  configs,
  setConfigs,
  savedConfigs,
  licenseStatus
}) => {
  const [slideOverService, setSlideOverService] = useState<any>(null);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-gray-900 flex items-center">
        <Briefcase className="w-5 h-5 mr-2 text-green-600" />
        Servicios que ofreces
      </h3>
      
      <div className="grid grid-cols-1 gap-4">
        {sortedServices.map(service => {
          const isSelected = watchedServices.includes(service.id);
          
          return (
            <ServiceItem
              key={service.id}
              service={service}
              isActive={isSelected}
              hasError={false}
              onToggle={() => handleToggleService(service.id)}
              onConfigClick={() => {
                setSlideOverService(service);
                handleExpand(service.id);
              }}
            />
          );
        })}
      </div>

      <SlideOver
        isOpen={!!slideOverService}
        onClose={() => setSlideOverService(null)}
        title={`Configurar ${slideOverService?.name || ''}`}
      >
        {slideOverService && (
          <div className="pb-[calc(8rem+env(safe-area-inset-bottom))] sm:pb-12">
            {slideOverService.name === 'Poda de palmeras' && (
              <PalmPricingConfigurator 
                value={configs.palmConfig} 
                initialConfig={savedConfigs['Poda de palmeras']}
                onChange={setConfigs.setPalmConfig} 
                onSave={(c) => handleWrapperSave('Poda de palmeras', c)} 
              />
            )}
            {slideOverService.name === 'Corte de césped' && (
              <LawnPricingConfigurator 
                value={configs.lawnConfig} 
                initialConfig={savedConfigs['Corte de césped']}
                onChange={setConfigs.setLawnConfig} 
                onSave={(c) => handleWrapperSave('Corte de césped', c)} 
              />
            )}
            {slideOverService.name === 'Poda de setos' && (
              <HedgePricingConfigurator 
                value={configs.hedgeConfig} 
                initialConfig={savedConfigs['Poda de setos']}
                onChange={setConfigs.setHedgeConfig} 
                onSave={(c) => handleWrapperSave('Poda de setos', c)} 
              />
            )}
            {slideOverService.name === 'Poda de árboles' && (
              <TreePruningConfigurator
                value={configs.treePruningConfig}
                initialConfig={savedConfigs['Poda de árboles']}
                onChange={setConfigs.setTreePruningConfig}
                onSave={(c) => handleWrapperSave('Poda de árboles', c)}
              />
            )}
            {slideOverService.name === 'Poda de plantas y arbustos' && (
              <ShrubPricingConfigurator 
                value={configs.shrubConfig} 
                initialConfig={savedConfigs['Poda de plantas y arbustos']}
                onChange={setConfigs.setShrubConfig} 
                onSave={(c) => handleWrapperSave('Poda de plantas y arbustos', c)} 
              />
            )}
            {slideOverService.name === 'Servicios fitosanitarios' && (
              <PhytosanitaryPricingConfigurator 
                value={configs.phytosanitaryConfig} 
                initialConfig={savedConfigs['Servicios fitosanitarios']}
                onChange={setConfigs.setPhytosanitaryConfig} 
                onSave={(c) => handleWrapperSave('Servicios fitosanitarios', c)}
                licenseStatus={licenseStatus} 
              />
            )}
            {slideOverService.name === 'Desbroce de malas hierbas' && (
              <WeedingPricingConfigurator 
                value={configs.weedingConfig} 
                initialConfig={savedConfigs['Desbroce de malas hierbas']}
                onChange={setConfigs.setWeedingConfig} 
                onSave={(c) => handleWrapperSave('Desbroce de malas hierbas', c)}
                licenseStatus={licenseStatus} 
              />
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
};

export default ServicesTab;
