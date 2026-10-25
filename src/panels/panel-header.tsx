import { useState } from "react";
import { RiSettings3Line } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { SchemaForm } from "@/components/schema-form";
import { getPanel } from "@/workspace/registry";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { COMMODITIES } from "@/lib/regions";
import { usePalette } from "@/lib/theme";
import { nextLinkGroup, useLinkGroups } from "@/workspace/link-groups";
import type { PanelApiLike, PanelParams } from "@/workspace/types";

/** Resolves a panel's commodity: the link group's when linked, otherwise the panel's own. */
export function usePanelCommodity(params: PanelParams, api: PanelApiLike) {
  const linked = useLinkGroups((state) => state.groups[params.linkGroup ?? ""]?.commodity);
  const setLinked = useLinkGroups((state) => state.setCommodity);
  const commodity = (params.linkGroup && linked) || params.commodity || "ZC";
  function change(next: string) {
    if (params.linkGroup) setLinked(params.linkGroup, next);
    else api.updateParameters({ commodity: next });
  }
  return { commodity, change };
}

type PanelHeaderProps = {
  eyebrow: string;
  title: string;
  api: PanelApiLike;
  params: PanelParams;
  commodity?: string;
  onCommodityChange?: (commodity: string) => void;
};

export function PanelHeader({ eyebrow, title, api, params, commodity, onCommodityChange }: PanelHeaderProps) {
  const group = params.linkGroup;
  const palette = usePalette();
  const schema = getPanel(params.kind)?.configSchema;
  const [configuring, setConfiguring] = useState(false);
  return (
    <>
    <div className="workspace-panel-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      <div className="panel-header-controls">
        <Button
          size="xs"
          variant="ghost"
          className="link-group-button"
          aria-label={group ? `Link group ${group}. Change group` : "Not linked. Choose a link group"}
          onClick={() => api.updateParameters({ linkGroup: nextLinkGroup(group) ?? null })}
        >
          <span aria-hidden="true" style={{ color: group ? palette.groups[group] : palette.muted }}>●</span>
          {group ? `LINK ${group}` : "UNLINKED"}
        </Button>
        {schema && (
          <Button size="xs" variant="ghost" aria-label="Panel settings" aria-expanded={configuring} onClick={() => setConfiguring((open) => !open)}>
            <RiSettings3Line aria-hidden="true" />
          </Button>
        )}
        {commodity && onCommodityChange && (
          <NativeSelect size="sm" aria-label="Commodity" value={commodity} onChange={(event) => onCommodityChange(event.currentTarget.value)}>
            {COMMODITIES.map((symbol) => <NativeSelectOption key={symbol} value={symbol}>{symbol}</NativeSelectOption>)}
          </NativeSelect>
        )}
      </div>
    </div>
    {schema && configuring && (
      <section className="panel-settings" aria-label="Panel settings">
        <SchemaForm schema={schema} values={params as Record<string, unknown>} onChange={(key, value) => api.updateParameters({ [key]: value === "" ? null : value })} />
      </section>
    )}
    </>
  );
}
