import { Clock, Lock } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import type { UnavailableRoute } from '../routes';

/**
 * Shown inside the app for roadmap areas that cannot be used in this version.
 * Says plainly that the area is unavailable; it never shows sample or fake data.
 */
export function NotAvailablePage({ title, reason }: Pick<UnavailableRoute, 'title' | 'reason'>) {
  const planned = reason === 'planned';
  const Icon = planned ? Clock : Lock;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="rounded-full bg-muted p-3 text-muted-foreground">
        <Icon className="size-6" />
      </span>
      <h1 className="mt-4 page-title text-3xl">
        {planned ? `${title} is planned` : `${title} is not available`}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {planned
          ? 'This feature is on the S-RABLE roadmap but is not part of this version yet.'
          : 'This area is turned off in this version. Nothing here can be viewed or changed.'}
      </p>
      <Button asChild className="mt-6">
        <Link to="/app/dashboard">Go to dashboard</Link>
      </Button>
    </div>
  );
}
