import { Banana, Box, Camera, File, Gamepad2, Headphones, Laptop, type LucideIcon, Package, PcCase, Smartphone, Tablet, Watch } from 'lucide-react';
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

// Resolve a device's icon: the dedicated banana glyph for the procedural banana mesh, otherwise
// the category icon.
export const deviceIcon = (device: Device): LucideIcon =>
  device.mesh === 'banana' ? Banana : CATEGORY_ICON[device.category];
