import React, { useState, useEffect } from 'react';
import { Shield, Upload, FileText, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { GardenerLicense } from '../../types';
import toast from 'react-hot-toast';

interface PhytosanitaryLicenseUploadProps {
  onStatusChange: (status: 'pending' | 'approved' | 'rejected' | null) => void;
}

const PhytosanitaryLicenseUpload: React.FC<PhytosanitaryLicenseUploadProps> = ({ onStatusChange }) => {
  const { user } = useAuth();
  const [license, setLicense] = useState<GardenerLicense | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [documentHash, setDocumentHash] = useState<string | null>(null);

  useEffect(() => {
    fetchLicense();
  }, [user]);

  useEffect(() => {
    // Cleanup preview URL on unmount or file change
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const fetchLicense = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('gardener_licenses')
        .select('*')
        .eq('gardener_id', user.id)
        .neq('status', 'replaced')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching license:', error);
      }
      
      setLicense(data as GardenerLicense);
      onStatusChange(data?.status || null);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const computeFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    const file = e.target.files[0];
    
    // Validate file size
    if (file.size > 10 * 1024 * 1024) {
      toast.error('El archivo es demasiado grande (máximo 10MB)');
      return;
    }
    
    // Validate file type
    const validTypes = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      toast.error('Formato no válido. Solo se admiten PDF, JPG o PNG.');
      return;
    }

    setDraftFile(file);
    
    // Compute Hash for legal integrity
    try {
      const hash = await computeFileHash(file);
      setDocumentHash(hash);
    } catch (err) {
      console.error('Error computing hash', err);
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(URL.createObjectURL(file));
  };

  const cancelDraft = () => {
    setDraftFile(null);
    setDocumentHash(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };

  const submitDraft = async () => {
    if (!draftFile || !user) return;
    if (!acceptedTerms) {
      toast.error('Debes aceptar la declaración responsable.');
      return;
    }

    setUploading(true);
    const fileExt = draftFile.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    try {
      // 1. Upload file to secure bucket
      const { error: uploadError } = await supabase.storage
        .from('private_licenses')
        .upload(filePath, draftFile, { upsert: true });

      if (uploadError) throw uploadError;

      // 2. Create record in gardener_licenses with legal integrity metadata
      const { error: dbError } = await supabase
        .from('gardener_licenses')
        .insert({
          gardener_id: user.id,
          license_number: licenseNumber,
          document_url: filePath,
          status: 'pending',
          terms_accepted: true,
          terms_accepted_at: new Date().toISOString(),
          document_hash: documentHash
        });

      if (dbError) throw dbError;

      toast.success('Documento enviado correctamente. En revisión.');
      setLicenseNumber('');
      setAcceptedTerms(false);
      setDraftFile(null);
      setPreviewUrl(null);
      setDocumentHash(null);
      fetchLicense();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error('Error al enviar el documento');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="animate-pulse h-20 bg-gray-100 rounded-xl"></div>;

  const renderStatus = () => {
    if (!license) return null;

    switch (license.status) {
      case 'approved':
        return (
          <div className="flex items-center gap-2 text-green-700 bg-green-50 p-3 rounded-lg border border-green-200">
            <CheckCircle className="w-5 h-5" />
            <div>
              <p className="font-medium">Licencia verificada</p>
              <p className="text-xs opacity-80">Estás habilitado para configurar y realizar tratamientos químicos.</p>
            </div>
          </div>
        );
      case 'pending':
        return (
          <div className="flex items-center gap-2 text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">
            <Clock className="w-5 h-5" />
            <div>
              <p className="font-medium">En revisión</p>
              <p className="text-xs opacity-80">Tu documento está siendo verificado por nuestro equipo.</p>
            </div>
          </div>
        );
      case 'rejected':
        return (
          <div className="flex items-center gap-2 text-red-700 bg-red-50 p-3 rounded-lg border border-red-200 mb-4">
            <AlertTriangle className="w-5 h-5" />
            <div>
              <p className="font-medium">Documento rechazado</p>
              <p className="text-xs opacity-80">Por favor, vuelve a subir un documento válido y legible.</p>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 sm:p-6 mb-6">
      <h3 className="text-lg font-bold text-gray-900 flex items-center mb-4">
        <Shield className="w-5 h-5 mr-2 text-blue-600" />
        Licencia de productos fitosanitarios
      </h3>
      
      <p className="text-sm text-gray-600 mb-4">
        Para poder ofrecer tratamientos con productos químicos (insecticidas, fungicidas, herbicidas), por ley debes acreditar tu carnet de manipulador de productos fitosanitarios.
      </p>

      {renderStatus()}

      {(!license || license.status === 'rejected') && (
        <div className="space-y-4 mt-4 bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Número de registro/licencia (opcional)
            </label>
            <input 
              type="text" 
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              className="w-full p-2 border border-gray-300 rounded-lg text-sm"
              placeholder="Ej: ES-XXXXX"
              disabled={uploading}
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input 
              type="checkbox" 
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-1"
              disabled={uploading}
            />
            <span className="text-xs text-gray-600">
              Declaro bajo mi responsabilidad que el documento adjunto es verídico, está en vigor y me habilita legalmente para la aplicación de productos fitosanitarios de uso profesional.
            </span>
          </label>

          <div className="relative">
            {!draftFile ? (
              <>
                <input 
                  type="file" 
                  id="license-upload"
                  accept="image/jpeg,image/png,image/jpg,.pdf" 
                  capture="environment"
                  className="hidden" 
                  onChange={handleFileSelect}
                  disabled={uploading}
                />
                <label 
                  htmlFor="license-upload"
                  className={`w-full flex flex-col items-center justify-center gap-2 py-6 px-4 rounded-xl border-2 border-dashed transition-colors
                    ${uploading 
                      ? 'border-gray-300 bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 cursor-pointer'}`}
                >
                  <Upload className="w-8 h-8 mb-2" />
                  <span className="font-medium text-base">Seleccionar archivo</span>
                  <span className="text-xs text-blue-600/70">JPG, PNG o PDF (máx. 10MB)</span>
                </label>
              </>
            ) : (
              <div className="bg-white border border-blue-200 rounded-xl p-4 flex flex-col items-center">
                <div className="mb-4 w-full flex justify-center bg-gray-50 rounded-lg overflow-hidden border border-gray-100 p-2 min-h-[120px] max-h-[300px]">
                  {draftFile.type === 'application/pdf' ? (
                    <div className="flex flex-col items-center justify-center text-red-500 py-8">
                      <FileText className="w-16 h-16 mb-2" />
                      <span className="text-sm font-medium text-gray-700 text-center max-w-[200px] truncate">{draftFile.name}</span>
                    </div>
                  ) : (
                    previewUrl && <img src={previewUrl} alt="Vista previa" className="max-w-full max-h-full object-contain" />
                  )}
                </div>
                
                <div className="flex w-full gap-3 mt-2">
                  <button
                    onClick={cancelDraft}
                    disabled={uploading}
                    className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 disabled:opacity-50 transition-colors"
                  >
                    Cambiar archivo
                  </button>
                  <button
                    onClick={submitDraft}
                    disabled={uploading || !acceptedTerms}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-md shadow-blue-600/20"
                  >
                    {uploading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        Enviando...
                      </>
                    ) : (
                      'Enviar Documento'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PhytosanitaryLicenseUpload;