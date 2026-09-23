import React, { useState } from 'react';

interface GarserLogoProps {
  className?: string;
  textClassName?: string;
}

/**
 * Logo oficial de GarSer con fallback a texto si la imagen falla al cargar.
 * Punto único de esta lógica: antes estaba copiada a mano en AuthForm y Navbar.
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
      src="/garser-logo.png"
      alt="GarSer.es — Garden Service"
      className={className}
      onError={() => setError(true)}
    />
  );
};

export default GarserLogo;
