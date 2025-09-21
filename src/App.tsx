import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthForm from './components/auth/AuthForm';
import Navbar from './components/layout/Navbar';
import ServiceCatalog from './components/client/ServiceCatalog';
import ServiceDetail from './components/client/ServiceDetail';
import ServiceBooking from './components/client/ServiceBooking';
import BookingsList from './components/client/BookingsList';
import GardenerDashboard from './components/gardener/GardenerDashboard';
import GoogleMapsDebug from './components/common/GoogleMapsDebug';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  return user ? <>{children}</> : <Navigate to="/auth" />;
};

const AppContent = () => {
  const { user, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-600"></div>
      </div>
    );
  }

  if (!user) {
    return <AuthForm />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />
      <Routes>
        <Route 
          path="/dashboard" 
          element={
            <ProtectedRoute>
              {profile?.role === 'gardener' ? <GardenerDashboard /> : <ServiceCatalog />}
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/service/:serviceId" 
          element={
            <ProtectedRoute>
              <ServiceDetail />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/booking" 
          element={
            <ProtectedRoute>
              <ServiceBooking />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/bookings" 
          element={
            <ProtectedRoute>
              <BookingsList />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/chat" 
          element={
            <ProtectedRoute>
              <div className="p-8 text-center">
                <h1 className="text-2xl font-bold">Chat</h1>
                <p className="text-gray-600 mt-2">Próximamente...</p>
              </div>
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/debug-maps" 
          element={
            <ProtectedRoute>
              <div className="p-8">
                <GoogleMapsDebug />
              </div>
            </ProtectedRoute>
          } 
        />
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/auth" element={<AuthForm />} />
      </Routes>
    </div>
  );
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <AppContent />
        <Toaster position="top-right" />
      </Router>
    </AuthProvider>
  );
}

export default App;