export type Category = 'everyday' | 'paper' | 'phone' | 'tablet' | 'laptop'
  | 'console' | 'pc-case' | 'audio' | 'camera' | 'watch';
export type RadiusAxis = 'x' | 'y' | 'z';
export interface Device {
  slug: string; name: string; category: Category;
  h: number; w: number; d: number;            // mm
  make?: string;              // manufacturer, e.g. "Apple"
  model?: string;             // model designation, e.g. "iPhone 17 Pro Max"
  rank?: number;              // suggestion weight; higher surfaces sooner (default 0)
  url?: string;               // optional link to the product / info page
  year?: number; aliases?: string[]; source?: string;
  radius?: number;            // mm; fillets edges parallel to radiusAxis
  radiusAxis?: RadiusAxis;    // x=width, y=height, z=depth
  screen?: { h: number; w: number; radius?: number }; // mm; inset rect on the +z front face
  mesh?: 'banana';            // procedural mesh override; always renders yellow wireframe
  // Optional real 3D model (glTF/GLB under /models). Rendered fit to this device's w×h×d in place
  // of the box; `rotation` (degrees XYZ) aligns the model's axes to our h=height/w=width/d=depth.
  model3d?: { url: string; rotation?: [number, number, number] };
}
export interface Catalog { version: number; devices: Device[]; }
export type ComparisonItem =
  | { kind: 'device'; device: Device }
  | { kind: 'custom'; name: string; h: number; w: number; d: number };
export type View = '3d' | 'front' | 'side' | 'top';
export type Units = 'metric' | 'imperial';
export type LayoutMode = 'row' | 'stack';
export const MAX_ITEMS = 8;
