import {
  Banana,
  Box,
  Camera,
  File,
  Gamepad2,
  Headphones,
  Laptop,
  type LucideIcon,
  Package,
  PcCase,
  Smartphone,
  Tablet,
  Watch,
  Wine,
} from 'lucide-react';
import type { Category, Device } from '../shared/types';

// Per-category lucide icon used to key device rows in search results and the empty-query preset
// suggestions. Rendered monochrome there — color only appears once an item is added to the
// comparison (see ItemList's tinted menu trigger).
export const CATEGORY_ICON: Record<Category, LucideIcon> = {
  everyday: Package,
  paper: File,
  phone: Smartphone,
  tablet: Tablet,
  laptop: Laptop,
  console: Gamepad2,
  'pc-case': PcCase,
  audio: Headphones,
  camera: Camera,
  watch: Watch,
};

// Fallback for user-defined ("my") custom items, which have no category.
export const MY_ITEM_ICON: LucideIcon = Box;

// Resolve a device's icon: procedurally-meshed items get a glyph of their own — they are specific
// things rather than members of a category — otherwise the category icon.
const MESH_ICON: Record<NonNullable<Device['mesh']>, LucideIcon> = {
  banana: Banana,
  bottle: Wine,
};
export const deviceIcon = (device: Device): LucideIcon =>
  (device.mesh && MESH_ICON[device.mesh]) || CATEGORY_ICON[device.category];
