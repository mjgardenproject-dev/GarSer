import React from 'react';
import { Link } from 'react-router-dom';
import LegalLayout, { Section } from './LegalLayout';
import { COOKIES_PATH, LEGAL_INFO, TERMS_PATH } from '../../../config/legal';

// Política de privacidad (2026-10-22). Base para revisar con un abogado: describe lo que la web hace
// de verdad (cuentas, inicio con Google, reservas, fotos con IA, pagos con Stripe, correos, avisos
// en el móvil, profesionales y carnets).
//
// Sin los datos del titular (nombre, NIF, domicilio) a petición del usuario (2026-10-22): se quitó
// la sección «Quién es el responsable» de aquí y «Quiénes somos» de TermsPage.tsx. El correo de
// contacto para privacidad sigue en «Tus derechos» (viene de src/config/legal.ts).

const PrivacyPage: React.FC = () => {
  const info = LEGAL_INFO;
  return (
    <LegalLayout
      title="Política de privacidad"
      intro="En GarSer tratamos tus datos solo para que puedas reservar servicios de jardinería, o prestarlos si eres profesional, y para que todo funcione con seguridad. Aquí te contamos qué datos usamos, para qué, con quién los compartimos y cómo puedes ejercer tus derechos."
    >
      <Section id="datos" title="1. Qué datos tratamos">
        <p><strong>Tu cuenta.</strong> Correo electrónico, contraseña (cifrada: nunca la vemos), nombre, teléfono y foto si los añades, y el tipo de cuenta (cliente, jardinero, empresa o empleado).</p>
        <p><strong>Si entras con Google.</strong> Google nos envía tu nombre, tu correo, tu foto de perfil y un identificador de tu cuenta de Google. No recibimos tu contraseña de Google ni ningún otro dato de tu cuenta.</p>
        <p><strong>Tus reservas.</strong> La dirección del jardín, los servicios y medidas que indicas, las fotos que subes para calcular el presupuesto, las fechas, los mensajes del chat con el profesional, las incidencias y las valoraciones.</p>
        <p><strong>Pagos.</strong> Los gastos de gestión se pagan con Stripe. GarSer no ve ni guarda los datos de tu tarjeta: solo el estado del pago y su importe.</p>
        <p><strong>Si eres profesional.</strong> Los datos de tu solicitud (nombre o empresa, NIF, teléfono, zona de trabajo, experiencia, fotos de trabajos), tu horario, tus precios y, si haces tratamientos fitosanitarios, la copia de tu carnet de aplicador y su fecha de caducidad. Si trabajas en una empresa, también lo que la empresa gestiona de ti (horario, servicios y trabajos asignados).</p>
        <p><strong>Datos técnicos.</strong> El dispositivo en el que activas los avisos en el móvil y registros técnicos de seguridad (por ejemplo, inicios de sesión).</p>
      </Section>

      <Section id="finalidades" title="2. Para qué los usamos y con qué base legal">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>Crear y gestionar tu cuenta</strong>, también si entras con Google. Base: el contrato de uso de GarSer.</li>
          <li><strong>Gestionar tus reservas:</strong> calcular el presupuesto (también a partir de tus fotos, con ayuda de inteligencia artificial), enviarlas al profesional, el chat, los cambios de fecha o precio, las incidencias y las valoraciones. Base: el contrato.</li>
          <li><strong>Cobrar los gastos de gestión y devolverlos</strong> cuando corresponda. Base: el contrato y las obligaciones legales contables y fiscales.</li>
          <li><strong>Enviarte correos y avisos del servicio</strong> (confirmaciones, cambios, recordatorios). Base: el contrato. Los avisos en el móvil solo si los activas (consentimiento), y puedes quitarlos cuando quieras.</li>
          <li><strong>Revisar a los profesionales y sus carnets fitosanitarios</strong> antes de que ofrezcan tratamientos químicos. Base: obligación legal sobre el uso de productos fitosanitarios e interés legítimo en la seguridad de los clientes.</li>
          <li><strong>Seguridad y prevención del fraude.</strong> Base: interés legítimo.</li>
        </ul>
        <p>No usamos tus datos para publicidad ni los vendemos a nadie.</p>
      </Section>

      <Section id="destinatarios" title="3. Con quién los compartimos">
        <p><strong>El profesional que hace tu servicio</strong> recibe lo necesario para hacerlo: tu nombre, la dirección, lo que has reservado y tus mensajes. Si eres profesional, tus clientes ven tu perfil público (nombre, foto, valoraciones y servicios).</p>
        <p><strong>Proveedores que nos prestan servicios</strong>, con contrato y solo para eso:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Supabase: base de datos, inicio de sesión y almacenamiento de archivos.</li>
          <li>Vercel: alojamiento de la web.</li>
          <li>Stripe: pagos.</li>
          <li>Brevo: envío de correos.</li>
          <li>Google: inicio de sesión con Google, mapas y direcciones, el análisis de las fotos para el presupuesto y, si aceptas cookies de publicidad, Google Ads.</li>
          <li>Meta (Instagram y Facebook): solo si aceptas cookies de publicidad.</li>
        </ul>
        <p>Algunos están fuera del Espacio Económico Europeo (por ejemplo, en Estados Unidos). En ese caso la transferencia se hace con las garantías del RGPD: cláusulas contractuales tipo de la Comisión Europea o el Marco de Privacidad de Datos UE-EE. UU.</p>
        <p>También podemos comunicar datos a las autoridades cuando una ley nos obligue.</p>
      </Section>

      <Section id="conservacion" title="4. Cuánto tiempo los guardamos">
        <p>Mientras tengas la cuenta. Si la cierras (puedes hacerlo desde «Mi cuenta»), borramos o anonimizamos tus datos personales y tus archivos. Solo guardamos lo que una ley nos obliga a conservar, como los datos de los pagos, durante los plazos legales.</p>
        <p>La copia del carnet fitosanitario se guarda mientras eres profesional en GarSer y se borra al cerrar la cuenta.</p>
      </Section>

      <Section id="derechos" title="5. Tus derechos">
        <p>Puedes pedir acceder a tus datos, corregirlos, borrarlos, oponerte a su uso, limitarlo o llevártelos a otro servicio. Escríbenos a <a className="font-semibold text-emerald-700 underline" href={`mailto:${info.privacyEmail}`}>{info.privacyEmail}</a> desde el correo de tu cuenta. Te responderemos en un mes como máximo.</p>
        <p>Si crees que no hemos tratado bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (<a className="font-semibold text-emerald-700 underline" href="https://www.aepd.es" target="_blank" rel="noopener noreferrer">www.aepd.es</a>).</p>
      </Section>

      <Section id="google" title="6. Inicio de sesión con Google">
        <p>Si eliges «Continuar con Google», Google te pide permiso para compartir con GarSer tu nombre, tu correo y tu foto. Solo los usamos para crear tu cuenta o entrar en ella. Si ya tenías una cuenta en GarSer con el mismo correo, se une a ella.</p>
        <p>Puedes quitar el acceso de GarSer cuando quieras desde la configuración de tu cuenta de Google. Tu cuenta de GarSer seguirá existiendo: podrás entrar con tu correo pidiendo una contraseña nueva en «¿Has olvidado tu contraseña?».</p>
      </Section>

      <Section id="almacenamiento" title="7. Cookies y almacenamiento en tu navegador">
        <p>GarSer guarda en tu navegador lo necesario para funcionar: tu sesión iniciada y la reserva que tienes a medias. Son cookies técnicas: no piden tu permiso porque sin ellas la web no funciona.</p>
        <p>Si aceptas en el aviso de cookies que te enseñamos, usamos también cookies de publicidad (Meta y Google Ads) para medir y mejorar cómo te enseñamos GarSer. No se instalan si no aceptas. El detalle está en la <Link className="font-semibold text-emerald-700 underline" to={COOKIES_PATH}>Política de cookies</Link>.</p>
        <p>Si usas «Continuar con Google» o el mapa de direcciones, se cargan servicios de Google, que pueden usar sus propias cookies para que funcionen. Puedes consultar su política en <a className="font-semibold text-emerald-700 underline" href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">policies.google.com</a>.</p>
      </Section>

      <Section id="menores" title="8. Menores">
        <p>GarSer es para mayores de 18 años. Si sabemos que una cuenta es de un menor, la cerraremos.</p>
      </Section>

      <Section id="cambios" title="9. Cambios en esta política">
        <p>Si la cambiamos, actualizaremos la fecha de arriba y, si el cambio es importante, te avisaremos. Las condiciones de uso están en <Link className="font-semibold text-emerald-700 underline" to={TERMS_PATH}>Términos y condiciones</Link>.</p>
      </Section>
    </LegalLayout>
  );
};

export default PrivacyPage;
