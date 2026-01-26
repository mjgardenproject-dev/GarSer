import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { CheckCircle, XCircle, Search } from 'lucide-react';
import DatabaseFix from '../debug/DatabaseFix';

interface Application {
  id: string;
  user_id: string;
  status: 'submitted'|'approved'|'rejected';
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

  useEffect(() => { fetchSubmitted(); }, []);

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
        .eq('status','submitted')
        .order('submitted_at', { ascending: false });
      if (error) {
        setErrorMsg(error.message || 'Error obteniendo solicitudes');
        setApps([]);
      } else {
        setApps(data || []);
      }
    } finally { setLoading(false); }
  };

  const approve = async (app: Application) => {
    setErrorMsg('');
    const gp = {
      user_id: app.user_id,
      full_name: app.full_name,
      phone: app.phone,
      address: app.city_zone,
      description: app.experience_description || app.certification_text || '',
      max_distance: 25,
      services: app.services || [],
      avatar_url: app.professional_photo_url || null,
      is_available: false,
      rating: 5.0,
      total_reviews: 0,
      // Extended fields
      tools_available: app.tools_available || [],
      experience_years: app.experience_years || 0,
      experience_description: app.experience_description,
      worked_for_companies: app.worked_for_companies,
      can_prove: app.can_prove,
      proof_photos: app.proof_photos || [],
      certification_text: app.certification_text,
      certification_photos: app.certification_photos || [],
      declaration_truth: app.declaration_truth,
      other_services: app.other_services
    } as any;

    const { data: exists, error: existsErr } = await supabase
      .from('gardener_profiles')
      .select('user_id')
      .eq('user_id', app.user_id)
      .maybeSingle();
    if (existsErr) { setErrorMsg(existsErr.message || 'Error comprobando perfil'); return; }

    let gpErr = null as any;
    if (exists) {
      const { error } = await supabase.from('gardener_profiles').update(gp).eq('user_id', app.user_id);
      gpErr = error;
    } else {
      const { error } = await supabase.from('gardener_profiles').insert(gp);
      gpErr = error;
    }
    if (gpErr) { setErrorMsg(gpErr.message || 'Error creando perfil de jardinero'); return; }

    const { error: roleErr } = await supabase.from('profiles').update({ role: 'gardener' }).eq('id', app.user_id);
    if (roleErr) { setErrorMsg(roleErr.message || 'Error actualizando rol'); return; }

    const { error: appErr } = await supabase.from('gardener_applications').update({ status: 'approved', reviewed_at: new Date().toISOString() }).eq('id', app.id);
    if (appErr) { setErrorMsg(appErr.message || 'Error actualizando solicitud'); return; }

    // Send email notification
    await sendNotification(app, 'gardener_approved');

    if (selected?.id === app.id) setSelected(null);
    fetchSubmitted();
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
      const { error } = await supabase
        .from('gardener_applications')
        .update({ 
          status: 'rejected', 
          reviewed_at: new Date().toISOString(), 
          review_comment: rejectReason 
        })
        .eq('id', appToReject.id);

      if (error) {
        setErrorMsg(error.message || 'Error rechazando solicitud');
        return;
      }

      // Send email notification
      await sendNotification(appToReject, 'gardener_rejected', rejectReason);

      setRejectModalOpen(false);
      setAppToReject(null);
      if (selected?.id === appToReject.id) setSelected(null);
      fetchSubmitted();
    } catch (e) {
      console.error(e);
      setErrorMsg('Error desconocido al rechazar');
    }
  };

  const filtered = apps.filter(a => (a.full_name||'').toLowerCase().includes(q.toLowerCase()) || (a.city_zone||'').toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">Solicitudes de Jardineros</h1>
          <button onClick={fetchSubmitted} disabled={loading} className="px-3 py-2 bg-gray-100 rounded">Actualizar</button>
        </div>
        {errorMsg && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800">
            {errorMsg}
          </div>
        )}
        <div className="flex items-center gap-2 mb-4">
          <Search className="w-4 h-4" />
          <input value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Buscar por nombre o zona" className="w-full p-2 border rounded text-base" />
        </div>
        <div className="grid grid-cols-1 gap-3">
          {filtered.map(app => (
            <div key={app.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold">{app.full_name}</div>
                  <div className="text-sm text-gray-600">{app.city_zone}</div>
                </div>
                {app.professional_photo_url && <img src={app.professional_photo_url} className="w-12 h-12 rounded-full object-cover" />}
              </div>
              <div className="mt-3 text-sm">
                <div><span className="font-medium">Servicios:</span> {(app.services||[]).join(', ')}</div>
                <div><span className="font-medium">Herramientas:</span> {(app.tools_available||[]).join(', ')}</div>
                <div><span className="font-medium">Experiencia:</span> {app.experience_range || ''} ({app.experience_years || 0} años)</div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button onClick={()=>approve(app)} className="px-3 py-2 bg-green-600 text-white rounded inline-flex items-center gap-2"><CheckCircle className="w-4 h-4" />Aprobar</button>
                <button onClick={()=>reject(app)} className="px-3 py-2 bg-red-600 text-white rounded inline-flex items-center gap-2"><XCircle className="w-4 h-4" />Rechazar</button>
                <button onClick={()=>setSelected(app)} className="px-3 py-2 bg-gray-100 rounded">Ver detalle</button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="text-sm text-gray-600">No hay solicitudes</div>}
        </div>
      </div>
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 overflow-y-auto max-h-[80vh]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Detalle de solicitud</h2>
              <button onClick={()=>setSelected(null)} className="px-3 py-1 bg-gray-100 rounded">Cerrar</button>
            </div>
            <div className="grid grid-cols-1 gap-4">
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Datos personales</div>
                <div className="text-sm">Nombre: {selected.full_name || '—'}</div>
                <div className="text-sm">Teléfono: {selected.phone || '—'}</div>
                <div className="text-sm">Zona: {selected.city_zone || '—'}</div>
                {selected.professional_photo_url && (
                  <div className="mt-2"><img src={selected.professional_photo_url} className="w-20 h-20 rounded-full object-cover" /></div>
                )}
              </div>
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Servicios</div>
                <div className="text-sm">{(selected.services||[]).join(', ') || '—'}</div>
                <div className="text-sm mt-1 border-t pt-1">
                  <span className="font-medium text-gray-600">Otros:</span> {selected.other_services || <span className="text-gray-400 italic">Ninguno especificado</span>}
                </div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Herramientas</div>
                <div className="text-sm">{(selected.tools_available||[]).join(', ') || '—'}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Experiencia</div>
                <div className="text-sm">Años: {selected.experience_years ?? 0}</div>
                {selected.experience_description && (
                  <div className="text-sm mt-2 whitespace-pre-line p-2 bg-gray-50 rounded">
                    {selected.experience_description}
                  </div>
                )}
                <div className="mt-2 text-sm">Trabajó para empresas: {selected.worked_for_companies ? 'Sí' : 'No'}</div>
                <div className="text-sm">Puede demostrar: {selected.can_prove ? 'Sí' : 'No'}</div>
              </div>
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Fotos de trabajos / CV</div>
                {(!selected.proof_photos || selected.proof_photos.length === 0) ? (
                  <div className="text-sm text-gray-500">No adjuntó archivos.</div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {(selected.proof_photos).map((u, i) => (
                      <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block group relative border rounded hover:shadow-md transition-shadow">
                        {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                          <img src={u} className="w-full h-28 object-cover rounded" alt={`Proof ${i}`} />
                        ) : (
                          <div className="w-full h-28 flex items-center justify-center bg-gray-100 text-gray-500 rounded flex-col">
                            <span className="text-xs p-2 text-center break-all">{u.split('/').pop()}</span>
                          </div>
                        )}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Formación</div>
                <div className="text-sm whitespace-pre-line">{selected.certification_text || '—'}</div>
                {selected.certification_photos && selected.certification_photos.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs font-semibold text-gray-500 mb-2 uppercase">Documentos de formación</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {(selected.certification_photos).map((u, i) => (
                        <a key={i} href={u} target="_blank" rel="noopener noreferrer" className="block group relative border rounded hover:shadow-md transition-shadow">
                          {u.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                            <img src={u} className="w-full h-28 object-cover rounded" alt={`Cert ${i}`} />
                          ) : (
                            <div className="w-full h-28 flex items-center justify-center bg-gray-100 text-gray-500 rounded flex-col">
                              <span className="text-xs p-2 text-center break-all">{u.split('/').pop()}</span>
                            </div>
                          )}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="border rounded-lg p-4">
                <div className="font-semibold mb-2">Declaraciones</div>
                <div className="text-sm">Veracidad: {selected.declaration_truth ? 'Aceptada' : 'No'}</div>
                <div className="text-sm">Términos: {selected.accept_terms ? 'Aceptados' : 'No'}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={()=>approve(selected)} className="px-3 py-2 bg-green-600 text-white rounded inline-flex items-center gap-2"><CheckCircle className="w-4 h-4" />Aprobar</button>
                <button onClick={()=>reject(selected)} className="px-3 py-2 bg-red-600 text-white rounded inline-flex items-center gap-2"><XCircle className="w-4 h-4" />Rechazar</button>
              </div>
              <div className="text-xs text-gray-300 mt-4 font-mono">
                ID: {selected.id}
                <br/>
                Submitted: {selected.submitted_at}
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Rejection Modal */}
      {rejectModalOpen && appToReject && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold mb-4 text-gray-800">Rechazar solicitud</h3>
            <p className="text-sm text-gray-600 mb-4">
              Por favor, indica el motivo del rechazo para informar a <strong>{appToReject.full_name}</strong>.
              Este mensaje se incluirá en el email que se le enviará.
            </p>
            <textarea
              className="w-full border rounded p-3 text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
              rows={4}
              placeholder="Ej: La experiencia demostrada no es suficiente para los servicios seleccionados..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="flex justify-end gap-3 mt-4">
              <button 
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 text-gray-600 bg-gray-100 rounded hover:bg-gray-200"
              >
                Cancelar
              </button>
              <button 
                onClick={confirmReject}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 font-medium"
              >
                Confirmar Rechazo
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && photoIndex !== null && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50">
          <div className="relative max-w-5xl w-full px-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-white text-sm">Foto {photoIndex+1} de {(selected.proof_photos||[]).length}</div>
              <button onClick={()=>setPhotoIndex(null)} className="px-3 py-1 bg-white rounded">Cerrar</button>
            </div>
            <div className="relative">
              <img src={(selected.proof_photos||[])[photoIndex!]} className="max-h-[70vh] w-full object-contain rounded" />
              <div className="absolute inset-y-0 left-0 flex items-center">
                <button
                  onClick={()=> setPhotoIndex((idx)=> idx!==null ? Math.max(0, idx-1) : idx)}
                  className="mx-2 px-3 py-2 bg-white rounded"
                >
                  ◀
                </button>
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center">
                <button
                  onClick={()=> setPhotoIndex((idx)=> {
                    if (idx===null) return idx;
                    const total = (selected.proof_photos||[]).length;
                    return Math.min(total-1, idx+1);
                  })}
                  className="mx-2 px-3 py-2 bg-white rounded"
                >
                  ▶
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Database Fix Tool - Visible only for admin to fix RLS issues */}
      <div className="mt-8 border-t pt-8">
        <DatabaseFix />
      </div>
    </div>
  );
};

export default ApplicationsAdmin;
