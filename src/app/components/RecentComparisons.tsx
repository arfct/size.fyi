import { getRecents } from '../localStore';

// Shown in the sidebar (where item rows go) when the comparison is empty — a compact list of the
// user's recent comparisons as links. Replaces the larger recents block that used to sit in the
// empty 3D area.
export default function RecentComparisons() {
  const recents = getRecents();
  if (recents.length === 0) return null;
  return (
    <section aria-label="Recent comparisons" className="space-y-1">
      <p className="px-4 text-[13px] font-medium text-stone-500">Recent</p>
      <ul>
        {recents.slice(0, 8).map((r) => (
          <li key={r.path}>
            <a
              href={r.path}
              className="block truncate rounded-md px-4 py-1 text-[16px] text-blue-600 hover:underline dark:text-blue-400"
            >
              {r.title}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
