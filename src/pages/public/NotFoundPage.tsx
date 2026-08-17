import { Link } from 'react-router-dom';
import { Home, Search } from 'lucide-react';

/**
 * Pantalla para URLs que no existen.
 *
 * Antes no había ruta comodín: una dirección mal escrita (o un enlace antiguo que alguien
 * compartió) dejaba la pantalla **en blanco**, sin explicación y sin salida. Para el visitante
 * es indistinguible de que la web esté caída, y se va.
 */
const NotFoundPage = () => {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4 py-16">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center mb-6">
          <Search className="w-8 h-8 text-green-600" aria-hidden="true" />
        </div>

        <p className="text-sm font-semibold text-green-700 mb-2">Error 404</p>
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
          Esta página no existe
        </h1>
        <p className="text-gray-600 mb-8">
          Puede que el enlace esté mal escrito o que la página haya cambiado de sitio.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-green-600 text-white font-medium hover:bg-green-700 focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:outline-none transition-colors"
          >
            <Home className="w-4 h-4" aria-hidden="true" />
            Ir al inicio
          </Link>
          <Link
            to="/reservar"
            className="inline-flex items-center justify-center px-5 py-3 rounded-xl border border-gray-300 bg-white text-gray-700 font-medium hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:outline-none transition-colors"
          >
            Reservar un servicio
          </Link>
        </div>
      </div>
    </div>
  );
};

export default NotFoundPage;
