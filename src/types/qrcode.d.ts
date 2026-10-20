// Tipos mínimos de `qrcode` (1.5.x), la parte que usan los materiales de marketing.
declare module 'qrcode' {
  export interface QRCodeRenderOptions {
    margin?: number;
    width?: number;
    scale?: number;
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    color?: { dark?: string; light?: string };
  }
  export function toCanvas(canvas: HTMLCanvasElement, text: string, options?: QRCodeRenderOptions): Promise<void>;
  export function toDataURL(text: string, options?: QRCodeRenderOptions & { type?: string }): Promise<string>;
  const QRCode: { toCanvas: typeof toCanvas; toDataURL: typeof toDataURL };
  export default QRCode;
}
