import { Navigate, useLocation, useParams } from 'react-router';

/**
 * Feature 7: Paper Trading moved into Live Trading (Paper) at /app/live. Old
 * /app/paper addresses (and their ?tab=) lead to the same view there.
 */
function paperTarget(search: string): string {
  const tab = new URLSearchParams(search).get('tab');
  if (tab === 'strategies') return '/app/live?tab=deployments';
  if (tab === 'performance') return '/app/live?tab=performance';
  if (tab === 'book' || tab === 'holdings' || tab === 'fills' || tab === 'settings')
    return `/app/live?tab=account&view=${tab}`;
  return '/app/live?tab=account';
}

export default function PaperRedirect() {
  return <Navigate to={paperTarget(useLocation().search)} replace />;
}

export function PaperDeploymentRedirect() {
  return <Navigate to={`/app/live/deployments/${useParams().id ?? ''}`} replace />;
}
