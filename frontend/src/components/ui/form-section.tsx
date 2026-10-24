/** A titled card of a form (the backtest and validation forms), named by its heading. */
export function FormSection(props: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = `section-${props.title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-xl border bg-card p-4 shadow-card sm:p-6"
    >
      <div className="space-y-1">
        <h2 id={id} className="font-semibold">
          {props.title}
        </h2>
        {props.description && <p className="text-sm text-muted-foreground">{props.description}</p>}
      </div>
      {props.children}
    </section>
  );
}
