import { RiInformationLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
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

/** The ⓘ toggle that shows a panel's guide in place. */
export function AboutButton({ open, onToggle, size = "xs" }: { open: boolean; onToggle: () => void; size?: "xs" | "sm" }) {
  return (
    <Button size={size} variant="ghost" aria-label="About this panel" title="About this panel" aria-expanded={open} onClick={onToggle}>
      <RiInformationLine aria-hidden="true" />
    </Button>
  );
}

/** A panel's guide shown beneath its header, with a pointer to the full guide. */
export function PanelAbout({ kind }: { kind: string }) {
  return (
    <section className="panel-about" aria-label="About this panel">
      <PanelGuide kind={kind} />
      <p className="panel-freshness">Press ? or type HELP in the command bar for every command and a glossary.</p>
    </section>
  );
}
