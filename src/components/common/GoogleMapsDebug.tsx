import React, { useState } from 'react';

const GoogleMapsDebug: React.FC = () => {
  const [testResult, setTestResult] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  const testBasicAPI = async () => {
    setIsLoading(true);
    setTestResult('🔄 Probando API básica...');

    try {
      // Probar con una llamada directa a la API sin librerías
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/geocode/json?address=Madrid,Spain&key=${apiKey}`
      );
      
      const data = await response.json();
      
      if (data.status === 'OK') {
        setTestResult('✅ API Key funciona correctamente - Geocoding API disponible');
      } else if (data.status === 'REQUEST_DENIED') {
        setTestResult(`❌ API Key rechazada: ${data.error_message || 'Permisos insuficientes'}`);
      } else if (data.status === 'OVER_QUERY_LIMIT') {
        setTestResult('❌ Cuota excedida en la API');
      } else {
        setTestResult(`❌ Error en API: ${data.status} - ${data.error_message || 'Error desconocido'}`);
      }
    } catch (error) {
      setTestResult(`❌ Error de conexión: ${error}`);
    }
    
    setIsLoading(false);
  };

  const testPlacesAPI = async () => {
    setIsLoading(true);
    setTestResult('🔄 Probando Places API...');

    try {
      // Probar Places API directamente
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=Madrid&key=${apiKey}&components=country:es`
      );
      
      const data = await response.json();
      
      if (data.status === 'OK') {
        setTestResult(`✅ Places API funciona - ${data.predictions?.length || 0} resultados encontrados`);
      } else if (data.status === 'REQUEST_DENIED') {
        setTestResult(`❌ Places API rechazada: ${data.error_message || 'No habilitada o permisos insuficientes'}`);
      } else {
        setTestResult(`❌ Places API Error: ${data.status} - ${data.error_message || 'Error desconocido'}`);
      }
    } catch (error) {
      setTestResult(`❌ Error de conexión Places API: ${error}`);
    }
    
    setIsLoading(false);
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-4">🔍 Diagnóstico Google Maps API</h2>
      
      <div className="space-y-4">
        <div>
          <h3 className="font-semibold text-gray-700">API Key configurada:</h3>
          <p className="font-mono text-sm bg-gray-100 p-2 rounded">
            {apiKey ? `${apiKey.substring(0, 20)}...` : '❌ No configurada'}
          </p>
        </div>

        <div className="space-y-2">
          <button
            onClick={testBasicAPI}
            disabled={isLoading || !apiKey}
            className="w-full bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 disabled:bg-gray-400"
          >
            {isLoading ? 'Probando...' : 'Probar Geocoding API (básica)'}
          </button>

          <button
            onClick={testPlacesAPI}
            disabled={isLoading || !apiKey}
            className="w-full bg-green-500 text-white px-4 py-2 rounded hover:bg-green-600 disabled:bg-gray-400"
          >
            {isLoading ? 'Probando...' : 'Probar Places API (autocompletado)'}
          </button>
        </div>

        {testResult && (
          <div className="bg-gray-50 p-4 rounded">
            <h3 className="font-semibold text-gray-700 mb-2">Resultado:</h3>
            <p className="text-lg">{testResult}</p>
          </div>
        )}

        <div className="bg-blue-50 p-4 rounded">
          <h3 className="font-semibold text-blue-700 mb-2">Información importante:</h3>
          <ul className="text-sm text-blue-600 space-y-1">
            <li>• <strong>Geocoding API:</strong> Convierte direcciones en coordenadas</li>
            <li>• <strong>Places API:</strong> Necesaria para autocompletado de direcciones</li>
            <li>• <strong>JavaScript API:</strong> Para aplicaciones web como React</li>
            <li>• Si Places API falla, el autocompletado no funcionará</li>
          </ul>
        </div>

        <div className="bg-yellow-50 p-4 rounded">
          <h3 className="font-semibold text-yellow-700 mb-2">Posibles problemas:</h3>
          <ul className="text-sm text-yellow-600 space-y-1">
            <li>• API Key no tiene Places API habilitada</li>
            <li>• Restricciones de dominio muy estrictas</li>
            <li>• Cuota diaria excedida</li>
            <li>• API Key configurada para otro tipo (Android/iOS)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default GoogleMapsDebug;