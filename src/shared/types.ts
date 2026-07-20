export type Category = 'everyday' | 'paper' | 'phone' | 'tablet' | 'laptop'
  | 'console' | 'pc-case' | 'audio' | 'camera';
export type RadiusAxis = 'x' | 'y' | 'z';
export interface Device {
  slug: string; name: string; category: Category;
  h: number; w: number; d: number;            // mm
  brand?: string; year?: number; aliases?: string[]; source?: string;
  radius?: number;            // mm; fillets edges parallel to radiusAxis
  radiusAxis?: RadiusAxis;    // x=width, y=height, z=depth
}
export interface Catalog { version: number; devices: Device[]; }
export type ComparisonItem =
  | { kind: 'device'; device: Device }
  | { kind: 'custom'; name: string; h: number; w: number; d: number };
export type View = '3d' | 'front' | 'side' | 'top';
export type Units = 'metric' | 'imperial';
export const MAX_ITEMS = 8;
