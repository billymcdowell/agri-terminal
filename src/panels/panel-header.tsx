import type { ReactNode } from "react";
import { useNavigation } from "@/shell/navigation";
import { PANEL_GUIDES } from "./help-text";

type PanelHeaderProps = {
  title: string;
  /** The section's key in the Help guides, such as "cot". Its one-line description becomes the subtitle. */
  kind: string;
  /** Inline pickers the section needs, such as a state or a river gauge. */
  controls?: ReactNode;
  /** One line on what the section shows, when it differs from its Help topic's. */
  subtitle?: string;
};

/** One line on what a section shows, with a link to its Help topic. */
export function SectionSubtitle({ kind, title, text }: { kind: string; title: string; text?: string }) {
  const openHelp = useNavigation((state) => state.openHelp);
  const guide = PANEL_GUIDES[kind];
  if (!guide) return null;
  return (
    <p className="section-subtitle">
      {text ?? guide.oneLine}{" "}
      <button type="button" className="section-help-link" aria-label={`More about ${title} in Help`} onClick={() => openHelp(kind)}>More in Help</button>
    </p>
  );
}

/** A section's heading, one line on what it shows, and a link to its Help topic. */
export function PanelHeader({ title, kind, controls, subtitle }: PanelHeaderProps) {
  return (
    <div className="workspace-panel-heading">
      <div className="section-titles">
        <h2>{title}</h2>
        <SectionSubtitle kind={kind} title={title} text={subtitle} />
      </div>
      {controls && <div className="panel-header-controls">{controls}</div>}
    </div>
  );
}
