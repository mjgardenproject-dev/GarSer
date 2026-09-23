import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * React Router no resetea el scroll al navegar entre rutas. Sin esto, si la página
 * anterior estaba scrolleada, la nueva aparece en la misma posición.
 */
const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
};

export default ScrollToTop;
