import React from 'react';
import LegalLayout, { Section } from './LegalLayout';
import { PRIVACY_PATH } from '../../../config/legal';
import { Link } from 'react-router-dom';

// Política de cookies (2026-10-22). Base para revisar con un abogado. Describe lo que la web hace de
// verdad: las cookies técnicas (siempre activas) y las de publicidad (Meta Pixel y Google Ads), que
// solo se cargan si aceptas en el banner (CookieConsentContext). Sin datos del titular, mismo criterio
// que PrivacyPage.tsx y TermsPage.tsx (2026-10-22).

const CookiesPage: React.FC = () => {
  return (
    <LegalLayout
      title="Política de cookies"
      intro="Una cookie es un archivo pequeño que una web guarda en tu navegador. Aquí te contamos cuáles usa GarSer, para qué, y cómo cambiar lo que has aceptado."
    >
      <Section id="necesarias" title="1. Cookies necesarias">
        <p>Siempre activas: sin ellas, GarSer no funciona. Guardan tu sesión iniciada y la reserva que tienes a medias. No piden tu permiso porque la ley no lo exige para este tipo de cookies.</p>
      </Section>

      <Section id="publicidad" title="2. Cookies de publicidad">
        <p>Solo se instalan si aceptas la categoría «Publicidad» en el aviso de cookies. Sirven para medir qué visitas de la web llegan a convertirse en reservas o en altas de profesional, y para enseñarte anuncios de GarSer en otras webs o redes.</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Meta (Instagram y Facebook).</strong> El píxel de Meta. Ve las páginas que visitas en garser.es y, si entras con tu cuenta, las acciones que haces (crear una cuenta, enviar una solicitud de alta, reservar). Más información en la <a className="font-semibold text-emerald-700 underline" href="https://www.facebook.com/privacy/policy/" target="_blank" rel="noopener noreferrer">política de privacidad de Meta</a>.</li>
          <li><strong>Google Ads.</strong> La etiqueta de Google Ads, con el mismo fin. Más información en la <a className="font-semibold text-emerald-700 underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">política de privacidad de Google</a>.</li>
        </ul>
        <p>Ninguna de las dos se instala antes de que aceptes, y ninguna se usa para venderte nada que no sea GarSer.</p>
      </Section>

      <Section id="duracion" title="3. Cuánto duran">
        <p>Las cookies de Meta y de Google duran hasta 90 días desde tu última visita. Tu decisión sobre el aviso de cookies se guarda en tu navegador (no es una cookie, es almacenamiento local) hasta 24 meses, o hasta que la cambies tú.</p>
      </Section>

      <Section id="cambiar" title="4. Cómo cambiar tu decisión">
        <p>Borra los datos de navegación de garser.es en tu navegador (o el almacenamiento local del sitio) y recarga la página: el aviso de cookies vuelve a salir. En el móvil suele estar en Ajustes del navegador → Privacidad → Datos de sitios web.</p>
      </Section>

      <Section id="mas" title="5. Más información">
        <p>Qué más datos tratamos y con qué base legal está en la <Link className="font-semibold text-emerald-700 underline" to={PRIVACY_PATH}>Política de privacidad</Link>.</p>
      </Section>
    </LegalLayout>
  );
};

export default CookiesPage;
