import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { User as UserIcon, Mail, Lock, Trash2, UploadCloud, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const MyAccount: React.FC = () => {
  const { user, profile, signOut } = useAuth();
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    setAvatarPreview(profile?.avatar_url || null);
  }, [profile?.avatar_url]);

  const onAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setAvatarFile(f);
    if (f) setAvatarPreview(URL.createObjectURL(f));
  };

  const saveAvatar = async () => {
    if (!user?.id || !avatarFile) return;
    setSavingAvatar(true);
    try {
      const ext = (avatarFile.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `${user.id}/avatar/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('applications')
        .upload(path, avatarFile, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = await supabase.storage.from('applications').getPublicUrl(path);
      const publicUrl = data.publicUrl;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('user_id', user.id);
      if (updateError) throw updateError;
      toast.success('Foto de perfil actualizada');
    } catch (e: any) {
      toast.error(e?.message || 'Error al actualizar la foto');
    } finally {
      setSavingAvatar(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!user?.email) {
      toast.error('No hay email asociado a la cuenta');
      return;
    }
    setSendingReset(true);
    try {
      const redirectTo = `${window.location.origin}/auth`;
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo });
      if (error) throw error;
      toast.success('Email de recuperación enviado');
    } catch (e: any) {
      toast.error(e?.message || 'Error enviando recuperación');
    } finally {
      setSendingReset(false);
    }
  };

  const closeAccount = async () => {
    if (!user?.id) return;
    const confirmed = window.confirm('¿Seguro que quieres cerrar tu cuenta? Esta acción elimina tus datos del perfil y te desconecta.');
    if (!confirmed) return;
    setClosing(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: '', phone: '', address: '', avatar_url: null })
        .eq('user_id', user.id);
      if (error) throw error;
      await signOut();
      toast.success('Cuenta cerrada');
    } catch (e: any) {
      toast.error(e?.message || 'Error al cerrar la cuenta');
    } finally {
      setClosing(false);
    }
  };

  const effectiveRole = profile?.role || ((user as any)?.user_metadata?.role === 'gardener' ? 'gardener' : 'client');

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="bg-white rounded-2xl shadow-xl p-6">
        <div className="flex items-center mb-6">
          <UserIcon className="w-6 h-6 text-green-600 mr-2" />
          <h1 className="text-2xl font-bold text-gray-900">Mi Cuenta</h1>
        </div>

        <div className="grid grid-cols-1 gap-6">
          <div className="border rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-lg font-semibold text-gray-900">Perfil</div>
                <div className="text-sm text-gray-600">{profile?.full_name || user?.email} · {effectiveRole === 'gardener' ? 'Jardinero' : 'Cliente'}</div>
              </div>
              {avatarPreview ? (
                <img src={avatarPreview} className="w-14 h-14 rounded-full object-cover" />
              ) : (
                <div className="w-14 h-14 rounded-full bg-gray-200" />
              )}
            </div>
            <div className="flex items-center gap-3">
              <label className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer inline-flex items-center">
                <UploadCloud className="w-4 h-4 mr-2" />
                Cambiar foto
                <input type="file" className="hidden" accept="image/*" onChange={onAvatarChange} />
              </label>
              <button
                onClick={saveAvatar}
                disabled={!avatarFile || savingAvatar}
                className="px-3 py-2 bg-green-600 text-white rounded-lg disabled:opacity-50"
              >
                Guardar
              </button>
            </div>
          </div>

          <div className="border rounded-xl p-4">
            <div className="flex items-center mb-3">
              <Lock className="w-5 h-5 text-green-600 mr-2" />
              <div className="text-lg font-semibold text-gray-900">Seguridad</div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-700">Enviar email para recuperar contraseña</div>
              <button
                onClick={sendPasswordReset}
                disabled={sendingReset}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                Enviar
              </button>
            </div>
          </div>

          <div className="border rounded-xl p-4">
            <div className="flex items-center mb-3">
              <Trash2 className="w-5 h-5 text-red-600 mr-2" />
              <div className="text-lg font-semibold text-gray-900">Cerrar cuenta</div>
            </div>
            <p className="text-sm text-gray-700 mb-3">Elimina tus datos del perfil y te desconecta. Para borrado completo del usuario, se requiere validación administrativa.</p>
            <button
              onClick={closeAccount}
              disabled={closing}
              className="px-3 py-2 bg-red-600 text-white rounded-lg"
            >
              Cerrar cuenta
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MyAccount;