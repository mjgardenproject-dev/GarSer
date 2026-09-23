import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckCircle, XCircle, Search, Shield, Eye, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { GardenerLicense } from '../../types';

interface LicenseWithProfile extends GardenerLicense {
  gardener_profiles: {
    full_name: string;
    phone: string;
  };
}

const LicenseVerificationAdmin: React.FC = () => {
  const [licenses, setLicenses] = useState<LicenseWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedLicense, setSelectedLicense] = useState<LicenseWithProfile | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [docError, setDocError] = useState(false);
  const [processing, setProcessing] = useState(false);
  // D1 (decisión del usuario, 2026-09-13): la caducidad la escribe el admin ANTES de
  // aprobar. Sin fecha (o con una ya pasada) no se puede aprobar — lo exige también la RPC
  // `review_gardener_license`, esto es solo para no dejar pulsar "Aprobar" en vano.
  const [expiresAt, setExpiresAt] = useState('');

  useEffect(() => {
    fetchPendingLicenses();
  }, []);

  const fetchPendingLicenses = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      // 1. Obtener licencias pendientes (usando auth.admin o ignorando RLS si es necesario)
      // Como el usuario actual es admin, deberia poder leer todo.
      const { data: licensesData, error: licensesError } = await supabase
        .from('gardener_licenses')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (licensesError) throw licensesError;

      if (!licensesData || licensesData.length === 0) {
        setLicenses([]);
        return;
      }

      // 2. Obtener perfiles de jardineros correspondientes
      const gardenerIds = licensesData.map((l: any) => l.gardener_id);
      const { data: profilesData, error: profilesError } = await supabase
        .from('gardener_profiles')
        .select('user_id, full_name, phone')
        .in('user_id', gardenerIds);

      if (profilesError) {
        console.warn('Error fetching gardener profiles for licenses:', profilesError);
      }

      // 3. Combinar datos
      const mergedLicenses = licensesData.map((license: any) => {
        const profile = profilesData?.find((p: any) => p.user_id === license.gardener_id);
        return {
          ...license,
          gardener_profiles: {
            full_name: profile?.full_name || 'Usuario Desconocido',
            phone: profile?.phone || '—'
          }
        };
      });

      setLicenses(mergedLicenses as LicenseWithProfile[]);
    } catch (e: any) {
      setErrorMsg(e.message || 'Error fetching licenses');
    } finally {
      setLoading(false);
    }
  };

  const viewDocument = async (license: LicenseWithProfile) => {
    setSelectedLicense(license);
    setSignedUrl(null);
    setDocError(false);
    setExpiresAt('');
    try {
      const { data, error } = await supabase.storage
        .from('private_licenses')
        .createSignedUrl(license.document_url, 60); // 60 seconds expiry

      if (error) throw error;
      setSignedUrl(data.signedUrl);
    } catch (e: any) {
      console.error(e);
      setDocError(true);
      toast.error('No se pudo cargar el documento de manera segura');
    }
  };

  const handleAction = async (status: 'approved' | 'rejected') => {
    if (!selectedLicense) return;
    if (status === 'approved' && !expiresAt) {
      toast.error('Indica la fecha de caducidad de la licencia antes de aprobarla.');
      return;
    }
    setProcessing(true);
    try {
      // Una sola llamada, atómica en el servidor (review_gardener_license): antes esto eran
      // dos UPDATE sueltos desde el navegador, uno por tabla y sin transacción entre ambos —
      // si el segundo fallaba, la licencia quedaba aprobada en una tabla y sin reflejar en
      // la otra. La RPC también exige la caducidad para aprobar, no solo esta pantalla.
      const { error } = await supabase.rpc('review_gardener_license', {
        p_license_id: selectedLicense.id,
        p_status: status,
        p_expires_at: status === 'approved' ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
      });

      if (error) throw error;

      toast.success(`Licencia ${status === 'approved' ? 'aprobada' : 'rechazada'} correctamente`);
      setSelectedLicense(null);
      setExpiresAt('');
      fetchPendingLicenses();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message || 'Error al actualizar la licencia');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="w-8 h-8 text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">Verificación de Licencias Fitosanitarias</h1>
      </div>

      {errorMsg && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg mb-6 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          <p>{errorMsg}</p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
          <h2 className="font-semibold text-gray-800">Licencias pendientes ({licenses.length})</h2>
          <button onClick={fetchPendingLicenses} className="text-sm text-blue-600 hover:text-blue-800">
            Actualizar
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Cargando licencias...</div>
        ) : licenses.length === 0 ? (
          <div className="p-8 text-center text-gray-500 flex flex-col items-center">
            <CheckCircle className="w-12 h-12 text-green-300 mb-3" />
            <p>No hay licencias pendientes de revisión.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {licenses.map(license => (
              <div key={license.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                <div>
                  <h3 className="font-bold text-gray-900">{license.gardener_profiles?.full_name || 'Usuario Desconocido'}</h3>
                  <p className="text-sm text-gray-600">Tel: {license.gardener_profiles?.phone || '—'}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    Subido: {new Date(license.created_at).toLocaleString()}
                    {license.license_number && ` • Ref: ${license.license_number}`}
                  </p>
                </div>
                <button 
                  onClick={() => viewDocument(license)}
                  className="px-4 py-2 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 flex items-center justify-center gap-2 transition-colors font-medium text-sm whitespace-nowrap"
                >
                  <Eye className="w-4 h-4" />
                  Revisar documento
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de revisión */}
      {selectedLicense && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-gray-200 flex justify-between items-center">
              <h3 className="font-bold text-gray-900">
                Revisión de Licencia: {selectedLicense.gardener_profiles?.full_name}
              </h3>
              <button 
                onClick={() => setSelectedLicense(null)}
                className="text-gray-400 hover:text-gray-600 w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100"
              >
                ✕
              </button>
            </div>
            
            <div className="p-4 flex-1 overflow-y-auto bg-gray-50">
              {docError ? (
                <div className="flex flex-col items-center justify-center h-48 bg-red-50 text-red-600 rounded-lg border border-red-100 p-6 text-center">
                  <AlertTriangle className="w-10 h-10 mb-3 opacity-80" />
                  <p className="font-semibold mb-1">No se pudo cargar el documento</p>
                  <p className="text-sm opacity-90 max-w-sm">
                    El archivo fue eliminado, la ruta es incorrecta o no cuentas con los permisos necesarios para visualizarlo.
                  </p>
                </div>
              ) : signedUrl ? (
                <div className="bg-white rounded-lg border border-gray-200 shadow-inner overflow-hidden flex justify-center">
                  {signedUrl.toLowerCase().includes('.pdf') ? (
                    <iframe src={signedUrl} className="w-full h-[60vh] min-h-[400px]" title="Documento PDF" />
                  ) : (
                    <img src={signedUrl} alt="Documento Fitosanitario" className="max-w-full max-h-[60vh] object-contain" />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-48 gap-3 text-gray-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-sm">Generando enlace seguro...</p>
                </div>
              )}
              
              <div className="mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg">
                <h4 className="font-semibold text-blue-900 mb-1">Declaración del Jardinero</h4>
                <p className="text-sm text-blue-800">
                  El jardinero ha marcado la casilla declarando bajo su responsabilidad que este documento es verídico, está en vigor y le habilita legalmente para la aplicación de productos fitosanitarios.
                </p>
                {selectedLicense.license_number && (
                  <p className="mt-2 text-sm font-medium text-blue-900">
                    Número proporcionado: {selectedLicense.license_number}
                  </p>
                )}
              </div>

              {/* D1: la caducidad se escribe ANTES de aprobar, no después. Sin fecha futura
                  no se puede aprobar (aquí y también en la RPC). */}
              <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                <label htmlFor="license-expires-at" className="block font-semibold text-amber-900 mb-1 text-sm">
                  Fecha de caducidad de la licencia
                </label>
                <p className="text-xs text-amber-800 mb-2">
                  Compruébala en el documento. Cuando pase esta fecha, la licencia caduca sola:
                  el profesional dejará de aparecer para tratamientos químicos y tendrá que
                  volver a subir el carnet y esperar tu aprobación.
                </p>
                <input
                  id="license-expires-at"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 10)}
                  className="px-3 py-2 border border-amber-300 rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 bg-white flex gap-3 justify-end rounded-b-2xl">
              <button
                onClick={() => handleAction('rejected')}
                disabled={processing || (!signedUrl && !docError)}
                className="px-6 py-2.5 bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 rounded-xl font-medium flex items-center gap-2 disabled:opacity-50"
              >
                <XCircle className="w-5 h-5" />
                Rechazar
              </button>
              <button
                onClick={() => handleAction('approved')}
                disabled={processing || (!signedUrl && !docError) || !expiresAt}
                title={!expiresAt ? 'Indica antes la fecha de caducidad' : undefined}
                className="px-6 py-2.5 bg-emerald-700 text-white hover:bg-emerald-800 rounded-xl font-medium flex items-center gap-2 disabled:opacity-50 shadow-lg shadow-emerald-700/20"
              >
                <CheckCircle className="w-5 h-5" />
                Aprobar Licencia
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default LicenseVerificationAdmin;