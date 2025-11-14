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
    if (this.isLoaded && window.google?.maps?.places) {
      return Promise.resolve();
    }

    // Si ya se está cargando, devolver la promesa existente
    if (this.isLoading && this.loadPromise) {
      return this.loadPromise;
    }

    // Verificar si ya existe el script y está completamente cargado
    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript && window.google?.maps?.places) {
      this.isLoaded = true;
      this.executeCallbacks();
      return Promise.resolve();
    }

    this.isLoading = true;
    this.loadPromise = new Promise((resolve, reject) => {
      // Limpiar callbacks globales anteriores
      if (window.initGoogleMaps) {
        delete window.initGoogleMaps;
      }

      // Crear callback global único con validación
      window.initGoogleMaps = () => {
        // Verificar que Google Maps esté completamente cargado
        if (window.google && window.google.maps && window.google.maps.places) {
          this.isLoaded = true;
          this.isLoading = false;
          this.executeCallbacks();
          resolve();
        } else {
          // Si no está completamente cargado, esperar un poco más
          setTimeout(() => {
            if (window.google && window.google.maps && window.google.maps.places) {
              this.isLoaded = true;
              this.isLoading = false;
              this.executeCallbacks();
              resolve();
            } else {
              this.isLoading = false;
              this.loadPromise = null;
              reject(new Error('Google Maps API not fully loaded'));
            }
          }, 100);
        }
      };

      // Crear script solo si no existe
      if (!existingScript) {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${import.meta.env.VITE_GOOGLE_MAPS_API_KEY}&libraries=places,geometry&loading=async&callback=initGoogleMaps`;
        script.async = true;
        script.defer = true;
        
        script.onerror = () => {
          this.isLoading = false;
          this.loadPromise = null;
          if (window.initGoogleMaps) {
            delete window.initGoogleMaps;
          }
          reject(new Error('Failed to load Google Maps API'));
        };

        document.head.appendChild(script);
      } else {
        // Si el script existe, verificar si ya se cargó
        if (window.google?.maps?.places) {
          window.initGoogleMaps();
        } else {
          // Esperar a que se cargue
          existingScript.addEventListener('load', () => {
            setTimeout(() => {
              if (window.google?.maps?.places) {
                window.initGoogleMaps();
              } else {
                this.isLoading = false;
                this.loadPromise = null;
                reject(new Error('Google Maps API not available after load'));
              }
            }, 100);
          });
        }
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
    return this.isLoaded && !!window.google?.maps?.places && !!window.google?.maps?.geometry;
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