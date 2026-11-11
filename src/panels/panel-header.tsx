import { useState, type ReactNode } from "react";
import { PANEL_GUIDES } from "./help-text";
import { AboutButton, PanelAbout } from "./panel-guide";

type PanelHeaderProps = {
  eyebrow: string;
  title: string;
  /** The section's key in the Help guides, such as "cot". */
  kind: string;
  /** Inline pickers the section needs, such as a state or a river gauge. */
  controls?: ReactNode;
};

export function PanelHeader({ eyebrow, title, kind, controls }: PanelHeaderProps) {
  const [about, setAbout] = useState(false);
  const hasGuide = !!PANEL_GUIDES[kind];
  return (
    <>
      <div className="workspace-panel-heading">
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <div className="panel-header-controls">
          {controls}
          {hasGuide && <AboutButton open={about} onToggle={() => setAbout((open) => !open)} />}
        </div>
      </div>
      {hasGuide && about && <PanelAbout kind={kind} />}
    </>
  );
}
