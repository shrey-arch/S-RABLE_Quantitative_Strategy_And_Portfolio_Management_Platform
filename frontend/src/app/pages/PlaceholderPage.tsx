/** Shown for routes whose page has not been built yet. */
export function PlaceholderPage({ title, phase }: { title: string; phase: number }) {
  return (
    <div className="mx-auto max-w-3xl space-y-3 p-8">
      <h1 className="page-title text-3xl">{title}</h1>
      <p className="text-sm text-muted-foreground">
        This page is built in roadmap Phase {phase}. The route works; the page is not built yet.
      </p>
    </div>
  );
}
