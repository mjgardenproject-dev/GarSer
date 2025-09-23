// Centralized Google Maps API loader to prevent duplicate loading
class GoogleMapsLoader {
  private static instance: GoogleMapsLoader;
  private isLoaded = false;
  private isLoading = false;
  private loadPromise: Promise<void> | null = null;
  private callbacks: (() => void)[] = [];

  private constructor() {}

  static getInstance(): GoogleMapsLoader {
    if (!GoogleMapsLoader.instance) {
      GoogleMapsLoader.instance = new GoogleMapsLoader();
    }
    return GoogleMapsLoader.instance;
  }

  async load(): Promise<void> {
    // Si ya está cargado, resolver inmediatamente
    if (this.isLoaded) {
      return Promise.resolve();
    }

    // Si ya se está cargando, devolver la promesa existente
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    // Verificar si ya existe el script
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript && window.google?.maps) {
      this.isLoaded = true;
      this.executeCallbacks();
      return Promise.resolve();
    }

    this.isLoading = true;
    this.loadPromise = new Promise((resolve, reject) => {
      // Limpiar callback global anterior si existe
      if (window.initGoogleMaps) {
        delete window.initGoogleMaps;
      }

      // Crear callback global único
      window.initGoogleMaps = () => {
        this.isLoaded = true;
        this.isLoading = false;
        this.executeCallbacks();
        resolve();
      };

      // Crear script solo si no existe
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places&callback=initGoogleMaps`;
        script.async = true;
        script.defer = true;
        
        script.onerror = () => {
          this.isLoading = false;
          this.loadPromise = null;
          reject(new Error('Failed to load Google Maps API'));
        };

        document.head.appendChild(script);
      } else {
        // Si el script existe pero no se ha cargado completamente
        existingScript.addEventListener('load', () => {
          if (window.google?.maps) {
            window.initGoogleMaps();
          }
        });
      }
    });

    return this.loadPromise;
  }

  onLoad(callback: () => void): void {
    if (this.isLoaded) {
      callback();
    } else {
      this.callbacks.push(callback);
    }
  }

  private executeCallbacks(): void {
    this.callbacks.forEach(callback => callback());
    this.callbacks = [];
  }

  isGoogleMapsLoaded(): boolean {
    return this.isLoaded && !!window.google?.maps;
  }
}

// Declaración global para TypeScript
declare global {
  interface Window {
    google: any;
    initGoogleMaps: () => void;
  }
}

export default GoogleMapsLoader.getInstance();