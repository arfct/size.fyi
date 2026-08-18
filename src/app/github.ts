import type { ComparisonItem } from '../shared/types';
import { itemDims } from '../shared/types';

const REPO = 'https://github.com/arfct/size.fyi';

// GitHub prefills an issue form from query parameters keyed by each field's `id` in the YAML. A key
// that matches no field is dropped in silence — the form still opens, just empty — so these strings
// are load-bearing and the tests below pin them against the templates.
const ADD_TEMPLATE = 'add-a-device.yml';
const ERROR_TEMPLATE = 'report-an-error.yml';

// Millimetres always, whatever unit the viewer is reading in. This is a data submission, not a
// display: a maintainer pasting it into a JSON file wants the number the catalog stores, and inches
// would have to be converted back by hand at exactly the moment precision matters.
export function dimsText(item: ComparisonItem): string {
  const d = itemDims(item);
  return `${d.h} × ${d.w} × ${d.d} mm`;
}

const url = (template: string, title: string, fields: Record<string, string>) => {
  const q = new URLSearchParams({ template, title });
  for (const [k, v] of Object.entries(fields)) q.set(k, v);
  return `${REPO}/issues/new?${q}`;
};

// "This isn't in the catalog — please add it." Offered on custom items, which are exactly the things
// someone had to type in because we didn't have them.
//
// `source` is deliberately left empty rather than guessed at. It's the one field we cannot know, it's
// the field that makes a request actionable, and leaving it blank in a form the person still has to
// submit is what stops one-tap suggesting from filling the tracker with unverifiable numbers.
export function catalogIssueUrl(item: ComparisonItem): string {
  const name = item.kind === 'device' ? item.device.name : item.name;
  return url(ADD_TEMPLATE, `Add: ${name}`, { name, dimensions: dimsText(item) });
}

// "Something here is wrong." Offered on catalog devices. `current` carries what we ship today, so a
// maintainer can see the disagreement without opening the site and the report records what was
// claimed at the time it was filed.
export function errorIssueUrl(item: ComparisonItem): string {
  if (item.kind !== 'device') throw new Error('errorIssueUrl expects a catalog device');
  const { name, slug } = item.device;
  return url(ERROR_TEMPLATE, `Error: ${name}`, {
    item: `${name} (${slug})`,
    current: dimsText(item),
  });
}
