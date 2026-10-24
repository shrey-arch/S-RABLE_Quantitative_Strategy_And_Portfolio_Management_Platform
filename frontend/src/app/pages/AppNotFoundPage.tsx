import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

/** Unknown address inside /app: shown within the app frame so navigation stays available. */
export default function AppNotFoundPage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <SearchX className="size-6" />
      </span>
      <h1 className="mt-4 page-title text-3xl">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The address may be mistyped, or the page has moved.
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}
