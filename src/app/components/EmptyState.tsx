import { getRecents } from '../localStore';

export default function EmptyState() {
  const recents = getRecents();
  return (
    <div className="pointer-events-auto flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <h2 className="text-xl font-semibold">Compare the size of anything</h2>
        <p className="mt-1 text-sm text-stone-500">
          Search for a device or enter dimensions, and see them side by side in 3D.
        </p>
      </div>
      {recents.length > 0 && (
        <div className="w-full max-w-md text-left">
          <h3 className="mb-2 text-sm font-medium text-stone-500">Recent comparisons</h3>
          <ul className="space-y-1">
            {recents.slice(0, 8).map((r) => (
              <li key={r.path}>
                <a href={r.path} className="text-sm text-blue-600 hover:underline dark:text-blue-400">{r.title}</a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
