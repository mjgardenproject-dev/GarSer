import React from 'react';
import { useBooking } from '../../contexts/BookingContext';
import AddressPage from './AddressPage';
import ServicesPage from './ServicesPage';
import DetailsPage from './DetailsPage';
// AvailabilityPage eliminado del flujo
import ProvidersPage from './ProvidersPage';
import ConfirmationPage from './ConfirmationPage';

const BookingFlow: React.FC = () => {
  const { currentStep } = useBooking();

  const renderCurrentStep = () => {
    switch (currentStep) {
      case 0:
        return <AddressPage />;
      case 1:
        return <ServicesPage />;
      case 2:
        return <DetailsPage />;
      case 3:
        return <ProvidersPage />;
      case 4:
        return <ConfirmationPage />;
      default:
        return <AddressPage />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {renderCurrentStep()}
    </div>
  );
};

export default BookingFlow;
