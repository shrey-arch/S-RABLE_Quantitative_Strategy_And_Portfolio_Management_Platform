import { NewRunPage } from '@/features/backtests/NewBacktestPage';

/**
 * /app/validation/new - the backtest form plus the validation settings, then
 * POST /validations. ?from=<backtest or validation id> fills it in.
 */
export default function NewValidationPage() {
  return <NewRunPage mode="validation" />;
}
