import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckCircle, XCircle, Search, X, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import DatabaseFix from '../debug/DatabaseFix';

interface Application {
  id: string;
  user_id: string;
  status: 'submitted' | 'approved' | 'rejected';
  full_name?: string;
  phone?: string;
  email?: string;
  city_zone?: string;
  professional_photo_url?: string;
  services?: string[];
  other_services?: string;
  tools_available?: string[];
  experience_years?: number;
  experience_range?: string;
  experience_description?: string;
  worked_for_companies?: boolean;
  can_prove?: boolean;
  proof_photos?: string[];
  test_grass_frequency?: string;
  test_hedge_season?: string;
  test_pest_action?: string;
  certification_text?: string;
  certification_photos?: string[];
  declaration_truth?: boolean;
  accept_terms?: boolean;
  submitted_at?: string;
}

const ApplicationsAdmin: React.FC = () => {
  const [apps, setApps] = useState<Application[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [selected, setSelected] = useState<Application | null>(null);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);

  // Rejection Modal State
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [appToReject, setAppToReject] = useState<Application | null>(null);

  useEffect(() => {
    fetchSubmitted();
  }, []);

  const sendNotification = async (app: Application, type: 'gardener_approved' | 'gardener_rejected', reason?: string) => {
    try {
      const { error } = await supabase.functions.invoke('send-email-notification', {
        body: {
          to: app.email, // If undefined, edge function will try to fetch using user_id
          user_id: app.user_id,
          type,
          data: {
            name: app.full_name || 'Jardinero',
            reason,
            loginUrl: `${window.location.origin}/auth`,
            applyUrl: `${window.location.origin}/gardener/apply`
          }
        }
      });
      
      if (error) console.error('Error enviando notificación:', error);
    } catch (err) {
      console.error('Error al invocar función de email:', err);
    }
  };

  const fetchSubmitted = async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const { data, error } = await supabase
        .from('gardener_applications')
        .select('*')
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: false });
      if (error) {
        setErrorMsg(error.message || 'Error obteniendo solicitudes');
        setApps([]);
      } else {
        setApps(data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const approve = async (app: Application) => {
    setErrorMsg('');
    
    try {
      // @ts-ignore - Supabase type inference for RPC arguments can be problematic
      const { error } = await supabase.rpc('admin_review_gardener_application', {
        p_application_id: app.id,
        p_status: 'approved'
      });

      if (error) {
        setErrorMsg(error.message || 'Error aprobando solicitud');
        return;
      }

      await sendNotification(app, 'gardener_approved');

      if (selected?.id === app.id) setSelected(null);
      fetchSubmitted();
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Error desconocido al aprobar');
    }
  };

  const reject = (app: Application) => {
    setAppToReject(app);
    setRejectReason('');
    setRejectModalOpen(true);
  };

  const confirmReject = async () => {
    if (!appToReject) return;
    if (!rejectReason.trim()) {
      alert('El motivo de rechazo es obligatorio');
      return;
    }

    try {
      // @ts-ignore - Supabase type inference for RPC arguments can be problematic
      const { error } = await supabase.rpc('admin_review_gardener_application', {
        p_application_id: appToReject.id,
        p_status: 'rejected',
        p_comment: rejectReason
      });

      if (error) {
        setErrorMsg(error.message || 'Error rechazando solicitud');
        return;
      }

      await sendNotification(appToReject, 'gardener_rejected', rejectReason);

      setRejectModalOpen(false);
      setAppToReject(null);
      if (selected?.id === appToReject.id) setSelected(null);
      fetchSubmitted();
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e.message || 'Error desconocido al rechazar');
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    return new Intl.DateTimeFormat('es-ES', {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(isoString));
  };

  const filtered = apps.filter(a => 
    (a.full_name || '').toLowerCase().includes(q.toLowerCase()) || 
    (a.city_zone || '').toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 gap-4">
        <div className="flex-1 w-full">
          <label htmlFor="search-applications" className="sr-only">Buscar por nombre o zona</label>
          <div className="relative">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input 
              id="search-applications"
              type="search"
              name="search"
              value={q} 
              onChange={(e) => setQ(e.target.value)} 
              placeholder="Buscar por nombre o zona…" 
              autoComplete="off"
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:border-blue-500 transition-colors"
            />
          </div>
        </div>
        <button 
          type="button"
          onClick={fetchSubmitted} 
          disabled={loading} 
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Actualizar
        </button>
      </div>

      <div aria-live="polite">
        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
            {errorMsg}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filtered.map(app => (
          <article key={app.id} className="border border-gray-200 rounded-xl p-5 bg-white shadow-sm hover:shadow-md transition-shadow flex flex-col">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0 flex-1 pr-4">
                <h3 className="font-semibold text-gray-900 truncate" title={app.full_name}>{app.full_name}</h3>
                <p className="text-sm text-gray-500 truncate" title={app.city_zone}>{app.city_zone}</p>
              </div>
              {app.professional_photo_url && (
                <img 
                  src={app.professional_photo_url} 
                  width={48}
                  height={48}
                  className="w-12 h-12 rounded-full object-cover shrink-0 bg-gray-100" 
                  alt={`Foto de ${app.full_name}`}
                  loading="lazy"
                />
              )}
            </div>
            
            <div className="text-sm text-gray-600 space-y-2 flex-1">
              <p className="line-clamp-2" title={(app.services || []).join(', ')}>
                <span className="font-medium text-gray-900">Servicios:</span> {(app.services || []).join(', ')}
              </p>
              <p className="line-clamp-1" title={(app.tools_available || []).join(', ')}>
                <span className="font-medium text-gray-900">Herramientas:</span> {(app.tools_available || []).join(', ')}
              </p>
              <p>
                <span className="font-medium text-gray-900">Experiencia:</span> {app.experience_range || ''} ({app.experience_years || 0} años)
              </p>
            </div>
            
            <div className="mt-5 flex flex-wrap items-center gap-2 pt-4 border-t border-gray-100">
              <button 
                type="button"
                onClick={() => approve(app)} 
                className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg inline-flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:outline-none transition-colors"
              >
                <CheckCircle className="w-4 h-4" aria-hidden="true" />
                Aprobar
              </button>
              <button 
                type="button"
                onClick={() => reject(app)} 
                className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg inline-flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 focus-visible:outline-none transition-colors"
              >
                <XCircle className="w-4 h-4" aria-hidden="true" />
                Rechazar
              </button>
              <button 
                type="button"
                onClick={() => setSelected(app)} 
                className="w-full px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-medium rounded-lg focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none transition-colors"
              >
                Ver detalle
              </button>
            </div>
          </article>
        ))}
      </div>
      
      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          No se encontraron solicitudes.
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-gray-200 shrink-0">
              <h2 id="modal-title" className="text-xl font-bold text-gray-900">Detalle de solicitud</h2>
              <button 
                type="button"
                onClick={() => setSelected(null)} 
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none transition-colors"
                aria-label="Cerrar detalle"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <section className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                  <h3 className="font-semibold text-gray-900 mb-3">Datos personales</h3>
                  <div className="space-y-2 text-sm text-gray-700">
                    <p><span className="font-medium text-gray-900">Nombre:</span> {selected.full_name || '—'}</p>
                    <p><span className="font-medium text-gray-900">Teléfono:</span> {selected.phone || '—'}</p>
                    <p><span className="font-medium text-gray-900">Zona:</span> {selected.city_zone || '—'}</p>
                  </div>
                  {selected.professional_photo_url && (
                    <div className="mt-4">
                      <img 
                        src={selected.professional_photo_url} 
                        width={80}
                        height={80}
                        className="w-20 h-20 rounded-full object-cover bg-gray-200 border border-gray-300" 
                        alt={`Foto de ${selected.full_name}`} 
                        loading="lazy"
                      />
                    </div>
                  )}
                </section>
                
                <section className="bg-gray-50 rounded-xl p-5 border border-gray-100">
                  <h3 className="font-semibold text-gray-900 mb-3">Experiencia</h3>
                  <div className="space-y-2 text-sm text-gray-700">
                    <p><span className="font-medium text-gray-900">Años:</span> {selected.experience_years ?? 0}</p>
                    <p><span className="font-medium text-gray-900">Trabajó para empresas:</span> {selected.worked_for_companies ? 'Sí' : 'No'}</p>
                    <p><span className="font-medium text-gray-900">Puede demostrar:</span> {selected.can_prove ? 'Sí' : 'No'}</p>
                  </div>
                  {selected.experience_description && (
                    <div className="mt-3 text-sm text-gray-700 whitespace-pre-line p-3 bg-white border border-gray-200 rounded-lg">
                      {selected.experience_description}
                    </div>
                  )}
                </section>

                <section className="bg-gray-50 rounded-xl p-5 border border-gray-100 md:col-span-2">
                  <h3 className="font-semibold text-gray-900 mb-3">Servicios y Herramientas</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Servicios</h4>
                      <p className="text-sm text-gray-700">{(selected.services || []).join(', ') || '—'}</p>
                      {selected.other_services && (
                        <p className="text-sm text-gray-700 mt-2">
                          <span className="font-medium text-gray-900">Otros:</span> {selected.other_services}
                        </p>
                      )}
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Herramientas</h4>
                      <p className="text-sm text-gray-700">{(selected.tools_available || []).join(', ') || '—'}</p>
                    </div>
                  </div>
                </section>

                <section className="bg-gray-50 rounded-xl p-5 border border-gray-100 md:col-span-2">
                  <h3 className="font-semibold text-gray-900 mb-3">Fotos de trabajos / CV</h3>
                  {(!selected.proof_photos || selected.proof_photos.length === 0) ? (
                    <p className="text-sm text-gray-500 italic">No adjuntó archivos.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                      {selected.proof_photos.map((u, i) => (
                        <a 
                          key={i} 
                          href={u} 
                          target="_blank" 
                          rel="noopener noreferrer" 
                          className="block group relative border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                          aria-label={`Ver archivo adjunto ${i + 1}`}
                        >
                          {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                            <img 
                              src={u} 
                              className="w-full h-32 object-cover" 
                              alt={`Trabajo ${i + 1}`} 
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-full h-32 flex items-center justify-center bg-gray-100 text-gray-500 p-2 text-center">
                              <span className="text-xs break-all line-clamp-3">{u.split('/').pop()}</span>
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  )}
                </section>

                <section className="bg-gray-50 rounded-xl p-5 border border-gray-100 md:col-span-2">
                  <h3 className="font-semibold text-gray-900 mb-3">Formación</h3>
                  <p className="text-sm text-gray-700 whitespace-pre-line mb-4">{selected.certification_text || '—'}</p>
                  
                  {selected.certification_photos && selected.certification_photos.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-3">Documentos de formación</h4>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        {selected.certification_photos.map((u, i) => (
                          <a 
                            key={i} 
                            href={u} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="block group relative border border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
                            aria-label={`Ver certificado ${i + 1}`}
                          >
                            {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                              <img 
                                src={u} 
                                className="w-full h-32 object-cover" 
                                alt={`Certificado ${i + 1}`} 
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-full h-32 flex items-center justify-center bg-gray-100 text-gray-500 p-2 text-center">
                                <span className="text-xs break-all line-clamp-3">{u.split('/').pop()}</span>
                              </div>
                            )}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
                
                <section className="bg-gray-50 rounded-xl p-5 border border-gray-100 md:col-span-2">
                  <h3 className="font-semibold text-gray-900 mb-3">Declaraciones</h3>
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className={`w-4 h-4 ${selected.declaration_truth ? 'text-green-500' : 'text-gray-300'}`} aria-hidden="true" />
                      <span className="text-gray-700">Veracidad de datos</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <CheckCircle className={`w-4 h-4 ${selected.accept_terms ? 'text-green-500' : 'text-gray-300'}`} aria-hidden="true" />
                      <span className="text-gray-700">Términos aceptados</span>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 flex flex-wrap items-center justify-between gap-4 rounded-b-2xl shrink-0">
              <div className="text-xs text-gray-500 font-mono">
                ID: {selected.id}<br/>
                Enviado: {formatDate(selected.submitted_at)}
              </div>
              <div className="flex gap-3">
                <button 
                  type="button"
                  onClick={() => reject(selected)} 
                  className="px-5 py-2.5 bg-white border border-red-200 text-red-700 hover:bg-red-50 hover:border-red-300 font-medium rounded-lg inline-flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none transition-colors"
                >
                  <XCircle className="w-4 h-4" aria-hidden="true" />
                  Rechazar
                </button>
                <button 
                  type="button"
                  onClick={() => approve(selected)} 
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg inline-flex items-center gap-2 focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:outline-none shadow-sm transition-colors"
                >
                  <CheckCircle className="w-4 h-4" aria-hidden="true" />
                  Aprobar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rejection Modal */}
      {rejectModalOpen && appToReject && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reject-title"
        >
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 id="reject-title" className="text-xl font-bold mb-3 text-gray-900">Rechazar solicitud</h3>
            <p className="text-sm text-gray-600 mb-5">
              Por favor, indica el motivo del rechazo para informar a <strong className="font-semibold text-gray-900">{appToReject.full_name}</strong>.
              Este mensaje se incluirá en el email.
            </p>
            <div className="mb-5">
              <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700 mb-2">Motivo del rechazo</label>
              <textarea
                id="reject-reason"
                className="w-full border border-gray-300 rounded-lg p-3 text-sm focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:border-red-500 focus-visible:outline-none transition-shadow resize-none"
                rows={4}
                placeholder="Ej: La experiencia demostrada no es suficiente para los servicios seleccionados…"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button 
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:outline-none font-medium transition-colors"
              >
                Cancelar
              </button>
              <button 
                type="button"
                onClick={confirmReject}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none font-medium shadow-sm transition-colors"
              >
                Confirmar Rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Photo Viewer Modal */}
      {selected && photoIndex !== null && (
        <div 
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-[70] p-4 overscroll-contain"
          role="dialog"
          aria-modal="true"
          aria-label="Visor de fotos"
        >
          <div className="relative max-w-5xl w-full flex flex-col items-center">
            <div className="w-full flex items-center justify-between mb-4">
              <div className="text-white text-sm font-medium">
                Foto {photoIndex + 1} de {(selected.proof_photos || []).length}
              </div>
              <button 
                type="button"
                onClick={() => setPhotoIndex(null)} 
                className="p-2 text-gray-300 hover:text-white hover:bg-white/10 rounded-full focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none transition-colors"
                aria-label="Cerrar visor"
              >
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>
            
            <div className="relative w-full flex items-center justify-center">
              <img 
                src={(selected.proof_photos || [])[photoIndex!]} 
                className="max-h-[80vh] max-w-full object-contain rounded-lg shadow-2xl" 
                alt={`Foto ampliada ${photoIndex + 1}`}
              />
              
              <button
                type="button"
                onClick={() => setPhotoIndex((idx) => idx !== null ? Math.max(0, idx - 1) : idx)}
                disabled={photoIndex === 0}
                className="absolute left-0 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-30 disabled:cursor-not-allowed transition-colors backdrop-blur-sm"
                aria-label="Foto anterior"
              >
                <ChevronLeft className="w-8 h-8" aria-hidden="true" />
              </button>
              
              <button
                type="button"
                onClick={() => setPhotoIndex((idx) => {
                  if (idx === null) return idx;
                  const total = (selected.proof_photos || []).length;
                  return Math.min(total - 1, idx + 1);
                })}
                disabled={photoIndex === (selected.proof_photos || []).length - 1}
                className="absolute right-0 p-3 bg-black/50 text-white rounded-full hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none disabled:opacity-30 disabled:cursor-not-allowed transition-colors backdrop-blur-sm"
                aria-label="Siguiente foto"
              >
                <ChevronRight className="w-8 h-8" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Database Fix Tool */}
      <div className="mt-8 border-t border-gray-200 pt-8">
        <DatabaseFix />
      </div>
    </div>
  );
};

export default ApplicationsAdmin;
