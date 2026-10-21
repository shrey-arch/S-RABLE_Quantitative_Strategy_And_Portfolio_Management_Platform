import type { ReactNode } from 'react';
import { Link } from 'react-router';

/** Centered card layout shared by the Login and Register pages. */
export function AuthLayout(props: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <Link
        to="/"
        className="mb-6 text-lg font-semibold tracking-tight text-foreground hover:text-primary"
      >
        S-RABLE
      </Link>
      <div className="w-full max-w-sm rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">{props.title}</h1>
        {props.subtitle && <p className="mt-1 text-sm text-muted-foreground">{props.subtitle}</p>}
        <div className="mt-6">{props.children}</div>
      </div>
    </main>
  );
}
