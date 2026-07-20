import { Box, Camera, File, Gamepad2, Headphones, Laptop, type LucideIcon, Package, PcCase, Smartphone, Tablet, Watch } from 'lucide-react';
import type { Category } from '../shared/types';

// Per-category lucide icon + accent color, used to key device rows in search results and the
// empty-query preset suggestions. Colors are mid-saturation so they read on light and dark.
export const CATEGORY_ICON: Record<Category, { Icon: LucideIcon; color: string }> = {
  everyday: { Icon: Package, color: '#65a30d' },
  paper: { Icon: File, color: '#ca8a04' },
  phone: { Icon: Smartphone, color: '#2563eb' },
  tablet: { Icon: Tablet, color: '#7c3aed' },
  laptop: { Icon: Laptop, color: '#0891b2' },
  console: { Icon: Gamepad2, color: '#dc2626' },
  'pc-case': { Icon: PcCase, color: '#475569' },
  audio: { Icon: Headphones, color: '#db2777' },
  camera: { Icon: Camera, color: '#ea580c' },
  watch: { Icon: Watch, color: '#059669' },
};

// Fallback for user-defined ("my") custom items, which have no category.
export const MY_ITEM_ICON: { Icon: LucideIcon; color: string } = { Icon: Box, color: '#78716c' };
