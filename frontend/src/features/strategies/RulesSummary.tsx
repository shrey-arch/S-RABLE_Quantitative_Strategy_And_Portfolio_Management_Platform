import { rulesSentences } from './strategy-config';

/** A no-code strategy's rules in plain sentences, as a backtest runs them. */
export function RulesSummary(props: { config: unknown; className?: string }) {
  return (
    <ul className={props.className ?? 'space-y-0.5'}>
      {rulesSentences(props.config).map((sentence) => (
        <li key={sentence} className="font-mono text-xs leading-5">
          {sentence}
        </li>
      ))}
    </ul>
  );
}
