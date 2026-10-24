import { Link } from 'react-router';

export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-8">
      <h1 className="page-title text-3xl">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        The address may be mistyped, or the page has moved.
      </p>
      <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
        â† Home
      </Link>
    </main>
  );
}
