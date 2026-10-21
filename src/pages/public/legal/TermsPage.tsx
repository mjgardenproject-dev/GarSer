import React from 'react';
import { Link } from 'react-router-dom';
import LegalLayout, { Fill, Section } from './LegalLayout';
import { LEGAL_INFO, PRIVACY_PATH } from '../../../config/legal';

// Términos y condiciones (2026-10-21). Base para revisar con un abogado. Lo que dicen de dinero y
// cancelaciones es lo que hace la app: los gastos de gestión se autorizan al enviar la solicitud y
// se cobran cuando el profesional la acepta; si no la acepta o caduca, no se cobran; si el cliente
// cancela con más de 24 h se devuelven enteros, con menos no; si cancela el profesional tras
// aceptarla, se devuelven (cancel_booking, 20260909120000).

const TermsPage: React.FC = () => {
  const info = LEGAL_INFO;
  return (
    <LegalLayout
      title="Términos y condiciones"
      intro="Estas son las condiciones para usar GarSer, la web que pone en contacto a personas que necesitan servicios de jardinería con jardineros autónomos y empresas de jardinería. Al crear una cuenta, también si entras con Google, las aceptas."
    >
      <Section id="titular" title="1. Quiénes somos">
        <p>
          GarSer es un servicio de <Fill value={info.ownerName} label="nombre o razón social" />, con NIF <Fill value={info.taxId} label="NIF o CIF" /> y domicilio en <Fill value={info.address} label="domicilio fiscal" />
          {info.registry.trim() ? <>, inscrita en {info.registry}</> : null}. Puedes escribirnos a <a className="font-semibold text-emerald-700 underline" href={`mailto:${info.contactEmail}`}>{info.contactEmail}</a>.
        </p>
      </Section>

      <Section id="servicio" title="2. Qué hace GarSer">
        <p>GarSer es una plataforma intermediaria. Los servicios de jardinería los prestan los profesionales (jardineros autónomos y empresas), que son independientes de GarSer y responsables de su trabajo. GarSer facilita encontrar profesional, calcular el presupuesto, reservar, hablar con el profesional y gestionar la reserva.</p>
        <p>Los profesionales pasan una revisión antes de aparecer a los clientes y, para ofrecer tratamientos con productos químicos, deben tener su carnet de aplicador de productos fitosanitarios aprobado y en vigor.</p>
      </Section>

      <Section id="cuenta" title="3. Tu cuenta">
        <ul className="list-disc space-y-1 pl-5">
          <li>Tienes que ser mayor de 18 años y dar datos verdaderos.</li>
          <li>Puedes entrar con tu correo y contraseña o con tu cuenta de Google. Si entras con Google y ya tenías cuenta con ese correo, se usa la misma cuenta.</li>
          <li>Eres responsable de lo que se haga con tu cuenta: no compartas tu contraseña.</li>
          <li>Puedes cerrar tu cuenta cuando quieras desde «Mi cuenta».</li>
        </ul>
      </Section>

      <Section id="reservas" title="4. Cómo funciona una reserva">
        <ul className="list-disc space-y-2 pl-5">
          <li>El presupuesto se calcula con los precios de cada profesional y lo que nos indicas (medidas, fotos, estado del jardín). Si al llegar el trabajo no coincide con lo descrito, el profesional puede proponerte otro precio o duración, y tú decides si lo aceptas.</li>
          <li>Tu reserva es una solicitud hasta que el profesional la acepta. Si no la acepta a tiempo, caduca.</li>
          <li>El profesional puede proponerte otra fecha; la reserva solo cambia si la aceptas.</li>
          <li>Al terminar, te pediremos que confirmes que el trabajo se hizo. Si hay un problema, puedes abrir una incidencia desde la reserva.</li>
        </ul>
      </Section>

      <Section id="pagos" title="5. Precios y pagos">
        <ul className="list-disc space-y-2 pl-5">
          <li><strong>El precio del servicio</strong> se paga directamente al profesional cuando termina el trabajo, por el medio que acordéis.</li>
          <li><strong>Los gastos de gestión de GarSer</strong> se pagan con tarjeta a través de Stripe. Se autorizan al enviar la solicitud y solo se cobran cuando el profesional la acepta. Si no la acepta o caduca, no se cobran.</li>
          <li>Algunas reservas no tienen gastos de gestión (por ejemplo, las de los clientes que trae el propio profesional con su enlace). En ese caso lo verás antes de reservar.</li>
        </ul>
      </Section>

      <Section id="cancelaciones" title="6. Cancelaciones y devoluciones">
        <ul className="list-disc space-y-2 pl-5">
          <li>Si cancelas <strong>con más de 24 horas</strong> de antelación al inicio del servicio, te devolvemos los gastos de gestión enteros (o no se llegan a cobrar).</li>
          <li>Si cancelas <strong>con menos de 24 horas</strong>, los gastos de gestión no se devuelven.</li>
          <li>Si el profesional cancela una reserva que ya había aceptado, te devolvemos los gastos de gestión.</li>
          <li>Si hay una incidencia con el servicio, la revisamos y, si procede, devolvemos los gastos de gestión. El precio del servicio lo resuelves con el profesional.</li>
        </ul>
      </Section>

      <Section id="profesionales" title="7. Si eres profesional">
        <ul className="list-disc space-y-2 pl-5">
          <li>Tu solicitud se revisa antes de que aparezcas a los clientes. Mantén al día tus datos, tus precios, tu zona y tu horario.</li>
          <li>Haz los trabajos que aceptas, en la fecha acordada y con el precio de la reserva (o el que el cliente acepte si propones otro).</li>
          <li>Para los tratamientos con productos químicos necesitas tu carnet de aplicador aprobado y en vigor. Si caduca, dejarás de poder hacerlos hasta que se apruebe el renovado. En una empresa, cada persona que aplica tiene que tener el suyo.</li>
          <li>Eres responsable de cumplir tus obligaciones fiscales, laborales y de seguros.</li>
          <li>Si cancelas una reserva aceptada, el cliente recupera los gastos de gestión y puede afectar a tu valoración.</li>
        </ul>
      </Section>

      <Section id="normas" title="8. Normas de uso">
        <ul className="list-disc space-y-1 pl-5">
          <li>Usa GarSer de buena fe: nada de datos falsos, suplantaciones ni contenidos ofensivos o ilegales.</li>
          <li>Las valoraciones tienen que ser sinceras y sobre un servicio real.</li>
          <li>Podemos retirar contenidos que incumplan estas normas y suspender o cerrar las cuentas que las incumplan.</li>
        </ul>
      </Section>

      <Section id="responsabilidad" title="9. Responsabilidad">
        <p>GarSer pone los medios para que la plataforma funcione bien y con seguridad, pero no presta los servicios de jardinería: de cada trabajo responde el profesional que lo hace. Nada de lo dicho limita los derechos que te da la ley como consumidor.</p>
      </Section>

      <Section id="datos" title="10. Tus datos">
        <p>Cómo tratamos tus datos está en la <Link className="font-semibold text-emerald-700 underline" to={PRIVACY_PATH}>Política de privacidad</Link>.</p>
      </Section>

      <Section id="ley" title="11. Cambios y ley aplicable">
        <p>Si cambiamos estas condiciones, actualizaremos la fecha de arriba y te avisaremos si el cambio es importante. Se rigen por la ley española. Si eres consumidor, puedes reclamar ante los tribunales de tu domicilio.</p>
      </Section>
    </LegalLayout>
  );
};

export default TermsPage;
