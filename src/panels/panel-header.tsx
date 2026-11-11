import { useState } from "react";
import { RiSettings3Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { SchemaForm } from "@/components/schema-form";
import { getPanel } from "@/workspace/registry";
import type { PanelApiLike, PanelParams } from "@/workspace/types";
import { PANEL_GUIDES } from "./help-text";
import { AboutButton, PanelAbout } from "./panel-guide";

type PanelHeaderProps = {
  eyebrow: string;
  title: string;
  api: PanelApiLike;
  params: PanelParams;
};

export function PanelHeader({ eyebrow, title, api, params }: PanelHeaderProps) {
  const schema = getPanel(params.kind)?.configSchema;
  const [configuring, setConfiguring] = useState(false);
  const [about, setAbout] = useState(false);
  const hasGuide = !!PANEL_GUIDES[params.kind];
  return (
    <>
    <div className="workspace-panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="panel-header-controls">
        {hasGuide && <AboutButton open={about} onToggle={() => setAbout((open) => !open)} />}
        {schema && (
          <Button size="xs" variant="ghost" aria-label="Panel settings" aria-expanded={configuring} onClick={() => setConfiguring((open) => !open)}>
            <RiSettings3Line aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
    {hasGuide && about && <PanelAbout kind={params.kind} />}
    {schema && configuring && (
      <section className="panel-settings" aria-label="Panel settings">
        <SchemaForm schema={schema} values={params as Record<string, unknown>} onChange={(key, value) => api.updateParameters({ [key]: value === "" ? null : value })} />
      </section>
    )}
    </>
  );
}
