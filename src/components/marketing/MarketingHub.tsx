import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Copy, Download, Lightbulb, Loader2, Lock, MessageCircle, Share2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useProviderSetupStatus } from '../../hooks/useProviderSetupStatus';
import { useMarketingProfile } from '../../hooks/useMarketingProfile';
import MaterialEditor from './MaterialEditor';
import MaterialPreview from './MaterialPreview';
import { getMaterial, PRINT_MATERIAL_IDS, thumbnailSize, type MaterialId } from '../../utils/marketing/materials';
import {
  bookingUrl,
  buildMarketingContent,
  clientMessages,
  defaultOptions,
  materialFileName,
  whatsappUrl,
  type MarketingOptions,
} from '../../utils/marketing/content';
import { loadImage, renderToBlob } from '../../utils/marketing/renderMaterial';
import { downloadFiles, logMarketingDownload } from '../../utils/marketing/exportMaterial';

// Marketing del profesional (jardinero y empresa): sus materiales para darse a conocer, con su QR
// y la marca de GarSer. Lo que se descarga trae clientes que reservan con él… y da a conocer GarSer.

interface Props {
  /** Jardinero: volver al panel. La empresa lo tiene como pestaña y no lo necesita. */
  onBack?: () => void;
  /** Lleva al apartado «Completa tu cuenta» (para poder descargar). */
  onCompleteAccount: () => void;
}

const OPTIONS_KEY = 'garser:marketing:options:';

function readSavedOptions(providerId: string): Partial<MarketingOptions> | null {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY + providerId);
    return raw ? (JSON.parse(raw) as Partial<MarketingOptions>) : null;
  } catch {
    return null;
  }
}

const TIPS = [
  { title: 'Una tarjeta en cada trabajo', text: 'Al terminar, deja la tarjeta «Próxima visita»: es como más te vuelven a llamar.' },
  { title: 'Buzonea donde ya trabajas', text: '100 flyers en las calles de tus clientes: los vecinos ya ven cómo dejas los jardines.' },
  { title: 'El QR en tus facturas', text: 'Pega una pegatina en cada factura o presupuesto en papel.' },
  { title: 'Una historia a la semana', text: 'Sube tu flyer o una foto de un jardín terminado cada semana: las historias duran 24 horas.' },
  { title: 'Tu furgoneta, tu anuncio', text: 'Con el vinilo, cada trayecto es publicidad. Ponlo a la altura de los ojos.' },
  { title: 'Pide reseñas', text: 'Pide a tus clientes contentos que valoren el servicio: las reseñas salen en tus materiales.' },
];

const MarketingHub: React.FC<Props> = ({ onBack, onCompleteAccount }) => {
  const { user } = useAuth();
  const { status, loading: statusLoading } = useProviderSetupStatus();
  const { profile, error: profileError } = useMarketingProfile(user?.id);
  const [avatar, setAvatar] = useState<HTMLImageElement | null>(null);
  const [options, setOptions] = useState<MarketingOptions | null>(null);
  const [openMaterial, setOpenMaterial] = useState<MaterialId | null>(null);
  const [qrBusy, setQrBusy] = useState(false);

  const visibleServices = useMemo(() => (status?.services ?? []).filter((s) => s.visible).map((s) => s.name), [status]);
  const canDownload = Boolean(status && !status.suspended && visibleServices.length > 0);
  const feeWaiverEnabled = Boolean(status?.fee_waiver_enabled);

  useEffect(() => {
    let alive = true;
    void loadImage(profile?.avatarUrl ?? null).then((img) => alive && setAvatar(img));
    return () => {
      alive = false;
    };
  }, [profile?.avatarUrl]);

  // Lo que eligió (estilo, titular, servicios…) vale para todos los materiales y se recuerda.
  useEffect(() => {
    if (!profile || !status || options) return;
    const base = defaultOptions(profile, visibleServices, new Date());
    const saved = readSavedOptions(profile.providerId);
    setOptions({ ...base, ...saved, services: (saved?.services ?? base.services).filter((s) => visibleServices.includes(s)) });
  }, [profile, status, options, visibleServices]);

  const changeOptions = (next: MarketingOptions) => {
    setOptions(next);
    if (!profile) return;
    try {
      localStorage.setItem(OPTIONS_KEY + profile.providerId, JSON.stringify(next));
    } catch {
      // Sin almacenamiento: no se recuerda, sin más.
    }
  };

  const link = profile ? bookingUrl(profile.providerId, 'enlace') : '';

  // Un contenido por material, que solo cambia si cambian los datos: si no, las vistas previas se
  // repintarían con cualquier cambio de la pantalla.
  const contents = useMemo(() => {
    if (!profile || !options) return null;
    const ids: MaterialId[] = ['social', 'qr_code', ...PRINT_MATERIAL_IDS];
    return Object.fromEntries(
      ids.map((id) => [id, buildMarketingContent({ profile, visibleServices, feeWaiverEnabled, options, source: id })]),
    ) as Record<MaterialId, ReturnType<typeof buildMarketingContent>>;
  }, [profile, options, visibleServices, feeWaiverEnabled]);
  const contentFor = (material: MaterialId) => contents?.[material] ?? null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se ha podido copiar el enlace');
    }
  };

  const shareLink = async () => {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: profile?.name ?? 'GarSer', url: link });
        return;
      } catch (error) {
        if ((error as { name?: string })?.name === 'AbortError') return;
      }
    }
    await copyLink();
  };

  const downloadQr = async () => {
    const content = contentFor('qr_code');
    if (!content || !profile) return;
    setQrBusy(true);
    try {
      const size = getMaterial('qr_code').sizes[0];
      const blob = await renderToBlob({ material: 'qr_code', size, content, avatar });
      await downloadFiles([new File([blob], materialFileName(profile.name, 'qr_code', size.id), { type: 'image/png' })]);
      void logMarketingDownload('qr_code', [size.id]);
      toast.success('QR descargado');
    } catch {
      toast.error('No se ha podido preparar el QR');
    } finally {
      setQrBusy(false);
    }
  };

  if (profileError) {
    return <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{profileError}</p>;
  }
  if (!profile || !options || (statusLoading && !status)) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-700" aria-label="Cargando" />
      </div>
    );
  }

  if (openMaterial) {
    return (
      <MaterialEditor
        material={getMaterial(openMaterial)}
        profile={profile}
        visibleServices={visibleServices}
        feeWaiverEnabled={feeWaiverEnabled}
        canDownload={canDownload}
        avatar={avatar}
        options={options}
        onOptionsChange={changeOptions}
        onBack={() => {
          setOpenMaterial(null);
          window.scrollTo({ top: 0 });
        }}
        onCompleteAccount={onCompleteAccount}
      />
    );
  }

  const social = getMaterial('social');
  const socialContent = contentFor('social');
  const qrContent = contentFor('qr_code');
  const messages = clientMessages({ kind: profile.kind, feeWaiverEnabled, link: bookingUrl(profile.providerId, 'whatsapp'), date: new Date() });
  const sectionTitle = 'mb-3 text-lg font-bold text-gray-900';

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-2 rounded-lg px-1 text-sm font-semibold text-gray-700 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver al panel
        </button>
      )}

      <header className="rounded-2xl bg-[#0E3A22] p-5 text-white sm:p-7">
        <h1 className="text-2xl font-bold sm:text-3xl">Marketing</h1>
        <p className="mt-2 max-w-2xl text-base text-white/90">
          Date a conocer y consigue más reservas. Todo lo que descargues lleva tu QR: quien lo escanea ve tu perfil y reserva {profile.kind === 'company' ? 'con vosotros' : 'contigo'} en un minuto.
        </p>
        {feeWaiverEnabled && <p className="mt-2 text-sm font-semibold text-[#7BE36F]">Tus clientes reservan sin gastos de gestión.</p>}
      </header>

      {!canDownload && (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between" role="status">
          <p className="flex items-start gap-2">
            <Lock className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <span>
              {status?.suspended
                ? 'Tu cuenta está suspendida: mientras siga así no puedes descargar materiales.'
                : 'Todavía no apareces a los clientes. Puedes ver tus materiales, pero para descargarlos completa tu cuenta: si alguien escanea tu QR ahora, no podrá reservarte.'}
            </span>
          </p>
          {!status?.suspended && (
            <button type="button" onClick={onCompleteAccount} className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white hover:bg-emerald-800">
              Completar mi cuenta
            </button>
          )}
        </div>
      )}

      {/* Tu QR y tu enlace */}
      <section aria-labelledby="qr-title" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        <h2 id="qr-title" className={sectionTitle}>Tu QR y tu enlace</h2>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {qrContent && (
            <MaterialPreview
              material="qr_code"
              size={getMaterial('qr_code').sizes[0]}
              content={qrContent}
              avatar={avatar}
              maxSide={480}
              delayMs={0}
              label="Tu código QR"
              className="mx-auto w-44 shrink-0 sm:mx-0"
            />
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <p className="text-sm text-gray-600">Quien lo escanee o abra el enlace verá tu perfil y podrá reservar contigo en un minuto.</p>
            <p className="truncate rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-800" title={link}>{link}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800 hover:bg-gray-50">
                <Copy className="h-4 w-4" aria-hidden="true" /> Copiar enlace
              </button>
              <button type="button" onClick={() => void shareLink()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800 hover:bg-gray-50">
                <Share2 className="h-4 w-4" aria-hidden="true" /> Compartir enlace
              </button>
              <button
                type="button"
                onClick={() => void downloadQr()}
                disabled={!canDownload || qrBusy}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {qrBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />} Descargar QR
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Redes sociales */}
      <section aria-labelledby="social-title">
        <h2 id="social-title" className={sectionTitle}>Para tus redes</h2>
        <button
          type="button"
          onClick={() => setOpenMaterial('social')}
          className="group flex w-full flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 sm:flex-row sm:items-center sm:p-6"
        >
          {socialContent && (
            <MaterialPreview
              material="social"
              size={social.sizes[0]}
              content={socialContent}
              avatar={avatar}
              maxSide={600}
              label="Tu flyer para redes"
              className="mx-auto w-40 shrink-0 sm:mx-0 sm:w-48"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-lg font-bold text-gray-900">{social.title}</span>
            <span className="mt-1 block text-gray-600">{social.use} En 4 tamaños: publicación, cuadrada, historia y horizontal.</span>
            <span className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white group-hover:bg-emerald-800">
              Crear mi flyer <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </span>
          </span>
        </button>
      </section>

      {/* Para imprimir */}
      <section aria-labelledby="print-title">
        <h2 id="print-title" className={sectionTitle}>Para imprimir</h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PRINT_MATERIAL_IDS.map((id) => {
            const material = getMaterial(id);
            const content = contentFor(id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => setOpenMaterial(id)}
                  className="flex h-full w-full gap-4 rounded-2xl border border-gray-200 bg-white p-4 text-left hover:border-emerald-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
                >
                  {content && (
                    <MaterialPreview
                      material={id}
                      size={thumbnailSize(material)}
                      content={content}
                      avatar={avatar}
                      maxSide={360}
                      label={`Vista previa: ${material.title}`}
                      className="flex h-28 w-24 shrink-0 items-center justify-center"
                    />
                  )}
                  <span className="min-w-0">
                    <span className="block font-bold text-gray-900">{material.title}</span>
                    <span className="mt-1 block text-sm text-gray-600">{material.use}</span>
                    <span className="mt-2 inline-flex items-center gap-1 text-sm font-bold text-emerald-700">
                      Personalizar y descargar <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Mensajes para tus clientes */}
      <section aria-labelledby="messages-title">
        <h2 id="messages-title" className={sectionTitle}>Mensajes para tus clientes</h2>
        <p className="mb-3 text-sm text-gray-600">Mándaselos por WhatsApp a tus clientes de siempre: con tu enlace reservan contigo en un minuto.</p>
        <ul className="grid gap-3 md:grid-cols-3">
          {messages.map((message) => (
            <li key={message.id} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-4">
              <p className="font-bold text-gray-900">{message.title}</p>
              <p className="mt-2 flex-1 text-sm text-gray-700">{message.text}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <a
                  href={whatsappUrl(message.text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-3 text-sm font-bold text-white hover:bg-emerald-800"
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" /> WhatsApp
                </a>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(message.text).then(
                      () => toast.success('Mensaje copiado'),
                      () => toast.error('No se ha podido copiar'),
                    );
                  }}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 text-sm font-bold text-gray-800 hover:bg-gray-50"
                >
                  <Copy className="h-4 w-4" aria-hidden="true" /> Copiar
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Ideas para promocionarte */}
      <section aria-labelledby="tips-title" className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-6">
        <h2 id="tips-title" className={sectionTitle}>Ideas para promocionarte</h2>
        <ul className="grid gap-4 sm:grid-cols-2">
          {TIPS.map((tip) => (
            <li key={tip.title} className="flex gap-3">
              <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>
                <span className="block font-semibold text-gray-900">{tip.title}</span>
                <span className="block text-sm text-gray-600">{tip.text}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
};

export default MarketingHub;
