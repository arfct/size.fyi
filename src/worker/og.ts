import { ImageResponse } from 'workers-og';
import { formatDims } from '../shared/dimensions';
import type { ComparisonItem, ResolvedDims, Units } from '../shared/types';
import { itemDims } from '../shared/types';
import { computeTargets } from '../three/layout';

// Mirror of the app palette (src/app/palette.ts). Kept in sync by hand so the Worker stays free of
// app-layer imports.
const PALETTE = ['#0072B2', '#D55E00', '#E69F00', '#009E73', '#56B4E9', '#CC79A7', '#999999'];
const BANANA_YELLOW = '#FFE135';
// Outline weight. Constant across items rather than scaled: it's the drawing's pen, not part of any
// object's size, and a stroke that thickened with the subject would misreport it.
//
// Capped at a fifth of an item's short side, which only bites on things too small to carry the full
// weight — a credit card beside a TV is 42px tall, and 12px of stroke top and bottom would leave it
// more outline than interior. Everything with a short side over 60px draws at STROKE.
const STROKE = 12;
const strokeFor = (w: number, h: number) =>
  Math.max(2, Math.min(STROKE, Math.round(Math.min(w, h) / 5)));
function colorFor(item: ComparisonItem, i: number): string {
  return item.kind === 'device' && item.device.mesh === 'banana'
    ? BANANA_YELLOW
    : PALETTE[i % PALETTE.length]!;
}

// 2:1. The card is almost entirely the objects now, so the frame should be the shape that gives them
// the most width per unit of height — a row of things standing side by side is wide, not tall.
export const OG_WIDTH = 1200;
export const OG_HEIGHT = 600;

// Card design version, carried in the og:image URL as `?v=`.
//
// Same reasoning as AR_MODEL_VERSION, and the same trap: the route answers `immutable` with a year to
// run, so a redesign would keep serving the old picture from the edge at an unchanged URL, with no way
// to purge from code. What the items MEASURE rides on `?g=` beside it, so correcting one device's
// radius refreshes only the cards containing it.
//
// Social scrapers cache on their side too, keyed by URL — a new URL is the only thing that reliably
// moves Twitter, Slack or iMessage off a copy they already hold.
//
// 1: filled rectangles, 1200x630, size.fyi wordmark, uniform 14% corner radius
// 2: outlines, 1200x600, no wordmark, catalog corner radii, real-world spacing
export const OG_VERSION = 2;

export interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight?: number;
  style?: 'normal' | 'italic';
}

// satori element vnode. Built directly (not from an HTML string) to avoid the HTML parser's
// text-splitting/child-count pitfalls: a node with a string child is text; a node with an array of
// children must set display:flex.
type Style = Record<string, string | number>;
interface VNode {
  type: 'div';
  props: { style: Style; children?: VNode[] | string };
}
const box = (style: Style, children?: VNode[] | string): VNode => ({
  type: 'div',
  props: { style, children },
});
const text = (value: string, style: Style): VNode => box(style, value);

// The radius of the FRONT face's corners, which is all this elevation can show.
//
// `radius` fillets the edges parallel to `radiusAxis`, so it only rounds what you see here when that
// axis points at the viewer (z) or when there's no axis at all (all-edge rounding, e.g. an AirPods
// case). A Mac mini rounds its vertical edges — a generous curve on its top face, and a perfectly
// square silhouette from the front. The old card gave every item the same 14% of its short side,
// which drew the mini as a squircle and a credit card as a lozenge.
//
// Returns the four corners in CSS order so a fold's tighter hinge side survives (see radiusInner).
function faceRadii(d: ResolvedDims): [number, number, number, number] {
  if (!d.radius || (d.radiusAxis && d.radiusAxis !== 'z')) return [0, 0, 0, 0];
  const outer = d.radius;
  const inner = d.radiusInner ?? outer;
  switch (d.hinge ?? 'left') {
    case 'right':
      return [outer, inner, inner, outer];
    case 'top':
      return [inner, inner, outer, outer];
    case 'bottom':
      return [outer, outer, inner, inner];
    default:
      return [inner, outer, outer, inner];
  }
}

// Renders the shareable OG card: the comparison at true relative scale on a common ground line, each
// item labelled with its name and dimensions. Fonts are supplied by the caller (self-hosted via the
// ASSETS binding — no external font CDN). Edge-cached, so a comparison rasterizes at most once per
// location.
//
// Spacing comes from the same computeTargets the 3D view uses, so the gaps are millimetres of real
// space rather than a constant number of pixels: two phones sit close together and a phone beside a
// door does not. That also fixes the old card's worst case, where a fixed 40px gap between a credit
// card and a TV read as though they were touching.
export function renderOgImage(items: ComparisonItem[], units: Units, fonts: OgFont[]): Response {
  const PAD = 48;
  const LABEL_H = 78; // name + dims + the gap above them
  const STAGE_H = OG_HEIGHT - PAD * 2 - LABEL_H;
  const STAGE_W = OG_WIDTH - PAD * 2;

  const dims = items.map(itemDims);
  // computeTargets sorts by volume and returns centres, matching what the viewer draws. Keys are just
  // indices here: this render is one-shot, so it needs no stable identity across frames.
  const keys = items.map((_, i) => String(i));
  const targets = computeTargets(
    dims.map((d) => ({ h: d.h, w: d.w, d: d.d })),
    keys,
    'row',
  );
  const placed = items
    .map((item, i) => {
      const d = dims[i]!;
      const centre = targets.get(keys[i]!)!.pos.x;
      return { item, d, i, left: centre - d.w / 2 };
    })
    .sort((a, b) => a.left - b.left);

  const spanW = Math.max(...placed.map((p) => p.left + p.d.w), 1);
  const maxH = Math.max(...dims.map((d) => d.h), 1);
  const scale = Math.min(STAGE_H / maxH, STAGE_W / spanW);
  const px = (mm: number) => Math.round(mm * scale);

  // Absolute placement rather than a flex row, because a label is usually wider than the thing it
  // names — "Credit Card" is five times the width of one. In a flex row that label sets the column
  // width and silently becomes the spacing, so a 15 mm gap rendered as 60 px and the whole point of
  // using real distances was lost. Items are positioned by their scaled coordinates; labels float
  // underneath, centred on their item and free to overlap the neighbouring column.
  const contentW = px(spanW);
  const originX = PAD + Math.round((STAGE_W - contentW) / 2);
  const groundY = PAD + STAGE_H;

  // Each label gets the space between its item's centre and its neighbours' — its Voronoi cell —
  // capped so a lone item doesn't sprawl. Labels are free-floating, so without this two long names
  // sitting close together simply overlap: "reMarkable Paper Pro Move" beside "reMarkable Paper Pro"
  // is the case that found it.
  const LABEL_MAX = 360;
  const centreX = placed.map((p) => px(p.left + p.d.w / 2));
  const slotOf = (n: number) => {
    const gaps = [centreX[n - 1], centreX[n + 1]]
      .filter((c): c is number => c !== undefined)
      .map((c) => Math.abs(centreX[n]! - c));
    return Math.min(LABEL_MAX, gaps.length ? Math.min(...gaps) - 12 : LABEL_MAX);
  };

  // satori can't measure text before layout, so the fit is estimated from character count — Inter's
  // average advance is a shade over half its size at these weights. One size for the whole card rather
  // than per label: mixed type sizes across three otherwise identical captions read as a mistake.
  const fitted = placed.map((p, n) => {
    const name = p.item.kind === 'device' ? p.item.device.name : p.item.name;
    const dimsText = formatDims(p.d, units);
    const need = Math.max(name.length * 0.58, dimsText.length * 0.46);
    return slotOf(n) / need;
  });
  const nameSize = Math.max(16, Math.min(28, Math.floor(Math.min(...fitted))));
  const dimsSize = Math.max(13, nameSize - 6);

  const itemNode = (p: (typeof placed)[number]): VNode => {
    const w = px(p.d.w);
    const h = px(p.d.h);
    // Scale the real radius with everything else, then cap at half the short side so a heavily
    // rounded object drawn small can't produce an invalid corner.
    const cap = Math.min(w, h) / 2;
    const radii = faceRadii(p.d)
      .map((r) => Math.min(px(r), cap))
      .join('px ');
    // box-sizing: border-box so the stroke is drawn INSIDE the true dimensions — otherwise every
    // outline would add 2 x STROKE to its object and the smallest items would be the most inflated.
    return box({
      position: 'absolute',
      left: originX + px(p.left),
      top: groundY - h,
      width: w,
      height: h,
      boxSizing: 'border-box',
      border: `${strokeFor(w, h)}px solid ${colorFor(p.item, p.i)}`,
      borderRadius: `${radii}px`,
    });
  };

  const labelNode = (p: (typeof placed)[number], n: number): VNode =>
    box(
      {
        position: 'absolute',
        left: originX + centreX[n]! - LABEL_MAX / 2,
        top: groundY + 18,
        width: LABEL_MAX,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      },
      [
        // nowrap so a long name can't push its dimensions line out of step with the others'.
        text(p.item.kind === 'device' ? p.item.device.name : p.item.name, {
          fontSize: nameSize,
          fontWeight: 600,
          color: '#1c1917',
          whiteSpace: 'nowrap',
        }),
        text(formatDims(p.d, units), {
          fontSize: dimsSize,
          color: '#78716c',
          marginTop: 6,
          whiteSpace: 'nowrap',
        }),
      ],
    );

  const tree = box(
    {
      position: 'relative',
      display: 'flex',
      width: '100%',
      height: '100%',
      backgroundColor: '#ffffff',
      fontFamily: 'Inter',
    },
    [...placed.map(itemNode), ...placed.map((p, n) => labelNode(p, n))],
  );

  return new ImageResponse(tree as unknown as string, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
}
