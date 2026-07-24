import { ImageResponse } from 'workers-og';
import type { ComparisonItem, Units } from '../shared/types';
import { itemDims } from '../shared/types';
import { formatDims } from '../shared/dimensions';

// Mirror of the app palette (src/app/palette.ts). Kept in sync by hand so the Worker stays free of
// app-layer imports.
const PALETTE = ['#0072B2', '#D55E00', '#E69F00', '#56B4E9', '#009E73', '#CC79A7', '#999999'];
const BANANA_YELLOW = '#FFE135';
function colorFor(item: ComparisonItem, i: number): string {
  return item.kind === 'device' && item.device.mesh === 'banana' ? BANANA_YELLOW : PALETTE[i % PALETTE.length]!;
}

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export interface OgFont { name: string; data: ArrayBuffer; weight?: number; style?: 'normal' | 'italic' }

// satori element vnode. Built directly (not from an HTML string) to avoid the HTML parser's
// text-splitting/child-count pitfalls: a node with a string child is text; a node with an array of
// children must set display:flex.
type Style = Record<string, string | number>;
interface VNode { type: 'div'; props: { style: Style; children?: VNode[] | string } }
const box = (style: Style, children?: VNode[] | string): VNode => ({ type: 'div', props: { style, children } });
const text = (value: string, style: Style): VNode => box(style, value);

// Renders the shareable OG card: comparison items as colour-coded rounded rectangles at true
// relative scale on a common ground line, each labelled with name + dimensions. Fonts are supplied
// by the caller (self-hosted via the ASSETS binding — no external font CDN). Edge-cached, so a
// comparison rasterizes at most once per location.
export function renderOgImage(items: ComparisonItem[], units: Units, fonts: OgFont[]): Response {
  const PAD = 64, GAP = 40, STAGE_H = 300, LABEL_H = 70;
  const dims = items.map(itemDims);
  const maxH = Math.max(...dims.map((d) => d.h), 1);
  const totalW = dims.reduce((s, d) => s + d.w, 0) + GAP * Math.max(items.length - 1, 0);
  const scale = Math.min(STAGE_H / maxH, (OG_WIDTH - PAD * 2) / Math.max(totalW, 1));

  const column = (item: ComparisonItem, i: number): VNode => {
    const d = dims[i]!;
    const w = Math.round(d.w * scale), h = Math.round(d.h * scale);
    return box({ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }, [
      box({ width: w, height: h, backgroundColor: colorFor(item, i), borderRadius: Math.round(Math.min(w, h) * 0.14) }),
      box({ display: 'flex', flexDirection: 'column', alignItems: 'center', height: LABEL_H, marginTop: 16 }, [
        text(item.kind === 'device' ? item.device.name : item.name, { fontSize: 26, fontWeight: 600, color: '#1c1917' }),
        text(formatDims(d, units), { fontSize: 20, color: '#78716c', marginTop: 6 }),
      ]),
    ]);
  };

  const tree = box(
    { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', backgroundColor: '#ffffff', fontFamily: 'Inter', padding: PAD },
    [
      text('size.fyi', { fontSize: 30, fontWeight: 700, color: '#1c1917' }),
      box({ display: 'flex', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', width: '100%', marginTop: 48 },
        items.flatMap((item, i): VNode[] => (i > 0
          ? [text('vs', { fontSize: 22, color: '#a8a29e', marginLeft: GAP, marginRight: GAP, paddingBottom: LABEL_H }), column(item, i)]
          : [column(item, i)]))),
    ],
  );

  return new ImageResponse(tree as unknown as string, { width: OG_WIDTH, height: OG_HEIGHT, fonts });
}
