import React from 'react';
import { useBooking } from '../../contexts/BookingContext';
import WelcomePage from './WelcomePage';
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
        return <WelcomePage />;
      case 1:
        return <AddressPage />;
      case 2:
        return <ServicesPage />;
      case 3:
        return <DetailsPage />;
      case 4:
        return <ProvidersPage />;
      case 5:
        return <ConfirmationPage />;
      default:
        return <WelcomePage />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {renderCurrentStep()}
    </div>
  );
};

export default BookingFlow;
