import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useBooking } from "../../contexts/BookingContext";
import { ChevronRight, MapPin, Calendar, Users, Shield } from 'lucide-react';

const WelcomePage: React.FC = () => {
  const navigate = useNavigate();
  const { resetBooking, setCurrentStep } = useBooking();

  const handleStart = () => {
    // Reinicia y avanza al paso de Dirección dentro del flujo sin cambiar la ruta
    resetBooking();
    setCurrentStep(1);
    // Usar navegación simple al contenedor del flujo para garantizar que estamos en él
    // (funciona tanto en /reservar como en /reserva)
    navigate('/reservar');
  };

  const features = [
    {
      icon: <MapPin className="w-6 h-6 text-green-600" />,
      title: 'Dirección precisa',
      description: 'Encuentra jardineros cerca de ti'
    },
    {
      icon: <Calendar className="w-6 h-6 text-green-600" />,
      title: 'Disponibilidad real',
      description: 'Horarios actualizados al instante'
    },
    {
      icon: <Users className="w-6 h-6 text-green-600" />,
      title: 'Jardineros verificados',
      description: 'Profesionales evaluados y confiables'
    },
    {
      icon: <Shield className="w-6 h-6 text-green-600" />,
      title: 'Pago seguro',
      description: 'Protegido y garantizado'
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex flex-col">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col justify-center px-6 pt-8 sm:pt-12 pb-32">
        <div className="max-w-md mx-auto w-full">
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
              GarSer<span className="text-green-600">.es</span>
            </h1>
            <p className="text-base sm:text-lg text-gray-600">
              Jardinería profesional a un clic
            </p>
          </div>

          {/* Main Content */}
          <div className="bg-white rounded-3xl shadow-xl p-8 mb-8">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-3">
                Transforma tu jardín
              </h2>
              <p className="text-gray-600 leading-relaxed">
                Reserva servicios de jardinería confiables en minutos. 
                Profesionales verificados, precios transparentes y 
                disponibilidad inmediata.
              </p>
            </div>

            {/* Features */}
            <div className="grid grid-cols-2 gap-4 mb-8">
              {features.map((feature, index) => (
                <div key={index} className="text-center p-4 rounded-xl bg-gray-50">
                  <div className="flex justify-center mb-2">
                    {feature.icon}
                  </div>
                  <h3 className="font-semibold text-gray-900 text-sm mb-1">
                    {feature.title}
                  </h3>
                  <p className="text-xs text-gray-600">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>

            {/* Trust Indicators */}
            <div className="flex justify-center items-center space-x-6 text-sm text-gray-500 mb-6">
              <div className="text-center">
                <div className="font-bold text-green-600">500+</div>
                <div>Jardineros</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-green-600">4.8★</div>
                <div>Valoración</div>
              </div>
              <div className="text-center">
                <div className="font-bold text-green-600">24h</div>
                <div>Disponibilidad</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed CTA */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-6 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] z-50">
        <div className="max-w-md mx-auto">
          <button
            onClick={handleStart}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 text-white py-4 px-6 rounded-2xl font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] transition-all duration-200 flex items-center justify-center"
          >
            Comenzar Reserva
            <ChevronRight className="w-5 h-5 ml-2" />
          </button>
          <p className="text-center text-gray-500 text-sm mt-3">
            Sin registro necesario • Cancelación gratuita
          </p>
        </div>
      </div>
    </div>
  );
};

export default WelcomePage;
