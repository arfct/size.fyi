export default function EmptyState() {
  return (
    <div className="pointer-events-auto flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div>
        <h2 className="text-xl font-semibold">Compare the size of anything</h2>
        <p className="mt-1 text-sm text-stone-500">
          Search for a device or enter dimensions, and see them side by side in 3D.
        </p>
      </div>
    </div>
  );
}
