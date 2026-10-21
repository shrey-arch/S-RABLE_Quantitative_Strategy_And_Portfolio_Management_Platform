import { Navigate, useParams } from 'react-router';

/** A run's page lives at /app/backtests/:id; the roadmap's /app/executions/:id leads there. */
export default function ExecutionRedirect() {
  return <Navigate to={`/app/backtests/${useParams().id ?? ''}`} replace />;
}
