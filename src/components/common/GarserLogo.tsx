import React, { useState } from 'react';

interface GarserLogoProps {
  className?: string;
  textClassName?: string;
}

/**
 * Logo oficial de GarSer con fallback a texto si la imagen falla al cargar.
 * Punto único de esta lógica: antes estaba copiada a mano en AuthForm y Navbar.
 *
 * Es el SVG vectorial de `public/garser-logo.svg`: nítido a cualquier tamaño y densidad de píxeles
 * y SIN fondo (el PNG anterior era RGB con un recuadro blanco que se veía sobre cualquier color).
 * Las letras son oscuras, así que va sobre fondos claros. El tamaño lo pone `className`, siempre
 * con `w-auto`: width/height solo reservan el hueco (proporción 1000×215) para que la página no
 * salte al cargar el logo.
 */
const GarserLogo: React.FC<GarserLogoProps> = ({
  className = 'h-8 w-auto',
  textClassName = 'text-xl font-bold text-gray-900',
}) => {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <span className={textClassName}>
        GarSer<span className="text-green-600">.es</span>
      </span>
    );
  }

  return (
    <img
      src="/garser-logo.svg"
      alt="GarSer.es — Garden Service"
      width={1000}
      height={215}
      className={className}
      onError={() => setError(true)}
    />
  );
};

export default GarserLogo;
