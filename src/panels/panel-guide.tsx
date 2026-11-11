import { PANEL_GUIDES } from "./help-text";

/** A panel's plain-language explanation: what it shows, how to read it, and its labels. */
export function PanelGuide({ kind }: { kind: string }) {
  const guide = PANEL_GUIDES[kind];
  if (!guide) return null;
  return (
    <div className="panel-guide">
      <p>{guide.summary}</p>
      <h3>How to read it</h3>
      <ul>{guide.howToRead.map((line) => <li key={line}>{line}</li>)}</ul>
      {guide.terms && (
        <>
          <h3>What the labels mean</h3>
          <dl>
            {guide.terms.map(([term, meaning]) => (
              <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
