import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import * as yup from 'yup';
import { Eye, EyeOff, User, Briefcase, Check, Mail, Lock, Leaf } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import EmailConfirmationModal from './EmailConfirmationModal';

const schema = yup.object({
  email: yup.string().email('Email inválido').required('Email requerido'),
  password: yup.string().min(6, 'Mínimo 6 caracteres').required('Contraseña requerida'),
  role: yup.string().oneOf(['client', 'gardener']).required('Rol requerido')
});

type FormData = {
  email: string;
  password: string;
  role: 'client' | 'gardener';
};

const AuthForm = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [selectedRole, setSelectedRole] = useState<'client' | 'gardener'>('client');
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<FormData>({
    resolver: yupResolver(schema),
    defaultValues: {
      email: '',
      password: '',
      role: 'client'
    }
  });

  // Sincronizar el campo del formulario con selectedRole
  useEffect(() => {
    setValue('role', selectedRole);
  }, [selectedRole, setValue]);

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      if (isLogin) {
        await signIn(data.email, data.password);
        toast.success('¡Bienvenido de vuelta!');
        // Redirigir al dashboard tras login exitoso
        navigate('/dashboard');
      } else {
        // Usar selectedRole en lugar de data.role para asegurar que se use el rol seleccionado
        const roleToUse = selectedRole;
        console.log('🔄 Iniciando registro con:', { email: data.email, role: roleToUse, selectedRole });
        await signUp(data.email, data.password, roleToUse);
        console.log('✅ Registro exitoso, mostrando modal');
        setRegisteredEmail(data.email);
        setShowEmailModal(true);
        reset(); // Limpiar el formulario después del registro exitoso
      }
    } catch (error: any) {
      console.error('❌ Error en registro:', error);
      toast.error(error.message || 'Ha ocurrido un error');
    } finally {
      setLoading(false);
    }
  };

  // Si ya hay usuario autenticado y estamos en /auth, redirigir automáticamente al dashboard
  // Evita que la pantalla de login permanezca visible tras un inicio de sesión correcto
  useEffect(() => {
    // No tenemos acceso directo a `user` aquí, pero este componente solo se muestra
    // cuando no hay usuario según AppContent; como refuerzo, redirigimos tras login via navigate arriba.
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-6 sm:p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-gradient-to-br from-green-600 to-green-700 rounded-2xl flex items-center justify-center">
              <Leaf className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            {isLogin ? 'Iniciar Sesión' : 'Crear Cuenta'}
          </h1>
          <p className="text-gray-600">
            {isLogin ? 'Accede a tu cuenta' : 'Únete a nuestra plataforma'}
          </p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                {...register('email')}
                type="email"
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="tu@email.com"
              />
            </div>
            {errors.email && (
              <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.email.message}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
              <input
                {...register('password')}
                type="password"
                className="w-full pl-10 pr-4 py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
            {errors.password && (
              <p className="mt-1 text-xs sm:text-sm text-red-600">{errors.password.message}</p>
            )}
          </div>

          {!isLogin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                ¿Qué tipo de cuenta necesitas?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Botón Cliente */}
                <button
                  type="button"
                  onClick={() => setSelectedRole('client')}
                  className={`relative p-3 sm:p-4 border-2 rounded-xl transition-all duration-200 ${
                    selectedRole === 'client'
                      ? 'border-green-500 bg-green-50 shadow-lg transform scale-105'
                      : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex flex-col items-center space-y-2">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      selectedRole === 'client' ? 'bg-green-500' : 'bg-gray-200'
                    }`}>
                      <User className={`w-6 h-6 ${
                        selectedRole === 'client' ? 'text-white' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="text-center">
                      <h3 className={`text-sm sm:text-base font-semibold ${
                        selectedRole === 'client' ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        Cliente
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 mt-1">
                        Busco servicios de jardinería
                      </p>
                    </div>
                  </div>
                  {selectedRole === 'client' && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>

                {/* Botón Jardinero */}
                <button
                  type="button"
                  onClick={() => setSelectedRole('gardener')}
                  className={`relative p-3 sm:p-4 border-2 rounded-xl transition-all duration-200 ${
                    selectedRole === 'gardener'
                      ? 'border-green-500 bg-green-50 shadow-lg transform scale-105'
                      : 'border-gray-200 hover:border-green-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex flex-col items-center space-y-2">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                      selectedRole === 'gardener' ? 'bg-green-500' : 'bg-gray-200'
                    }`}>
                      <Briefcase className={`w-6 h-6 ${
                        selectedRole === 'gardener' ? 'text-white' : 'text-gray-600'
                      }`} />
                    </div>
                    <div className="text-center">
                      <h3 className={`text-sm sm:text-base font-semibold ${
                        selectedRole === 'gardener' ? 'text-green-700' : 'text-gray-700'
                      }`}>
                        Jardinero
                      </h3>
                      <p className="text-xs sm:text-sm text-gray-500 mt-1">
                        Ofrezco servicios de jardinería
                      </p>
                    </div>
                  </div>
                  {selectedRole === 'gardener' && (
                    <div className="absolute -top-2 -right-2 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </button>
              </div>
              
              {/* Indicador visual del rol seleccionado */}
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-700 text-center">
                  <strong>Rol seleccionado:</strong> {selectedRole === 'client' ? 'Cliente' : 'Jardinero'}
                  <span className="block text-xs sm:text-sm text-green-600 mt-1">
                    Este rol será permanente y no podrá cambiarse después del registro
                  </span>
                </p>
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-green-600 text-white py-2.5 px-4 text-sm rounded-lg font-semibold hover:bg-green-700 focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Procesando...' : (isLogin ? 'Iniciar Sesión' : 'Crear Cuenta')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            onClick={() => setIsLogin(!isLogin)}
            className="text-green-600 hover:text-green-700 font-medium text-sm"
          >
            {isLogin ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
          </button>
        </div>
      </div>

      {/* Modal de confirmación de email */}
      <EmailConfirmationModal
        isOpen={showEmailModal}
        onClose={() => {
          setShowEmailModal(false);
          setIsLogin(true); // Cambiar a modo login después de cerrar el modal
        }}
        email={registeredEmail}
      />
    </div>
  );
};

export default AuthForm;