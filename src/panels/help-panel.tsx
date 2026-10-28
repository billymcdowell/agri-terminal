import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { requestCommand } from "@/workspace/command-events";
import { listPanels } from "@/workspace/registry";
import { TEMPLATES } from "@/workspace/templates";
import type { PanelComponentProps } from "@/workspace/types";
import { GLOSSARY, guideTexts, matchesQuery, OTHER_COMMANDS, PANEL_GUIDES, SHORTCUT_NOTE, SHORTCUTS, START_HERE, STATUS_LABELS } from "./help-text";
import { PanelGuide } from "./panel-guide";
import { PanelHeader } from "./panel-header";

/** Every command, what each panel shows, the status labels and a glossary, searchable in one place. */
export function HelpPanel({ api, params }: PanelComponentProps) {
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const searching = query.trim() !== "";
  const panels = listPanels().filter((panel) => panel.type !== "help" && PANEL_GUIDES[panel.type] && matchesQuery(query, ...guideTexts(panel.title, PANEL_GUIDES[panel.type])));
  const commands = [
    ...TEMPLATES.map((template) => ({ usage: `TEMPLATE ${template.id}`, meaning: `Replace the layout with the ${template.name} set: ${template.description}` })),
    ...OTHER_COMMANDS,
  ].filter((item) => matchesQuery(query, item.usage, item.meaning));
  const shortcuts = SHORTCUTS.filter((item) => matchesQuery(query, item.keys, item.action));
  const statuses = STATUS_LABELS.filter(([label, meaning]) => matchesQuery(query, label, meaning));
  const terms = GLOSSARY.filter(([term, meaning]) => matchesQuery(query, term, meaning));
  const nothing = !panels.length && !commands.length && !shortcuts.length && !statuses.length && !terms.length;

  function open(command: string) {
    setNotice(requestCommand(command) ? "" : `Open this from the main window: press / and type ${command}.`);
  }

  return (
    <div className="workspace-panel help-panel">
      <PanelHeader eyebrow="HELP" title="Guide to AgriTerminal" api={api} params={params} />
      <Input className="help-search" type="search" aria-label="Search help" placeholder="Search help, such as ending stocks or COT" value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      {notice && <p role="status" className="panel-freshness" data-status="stale">{notice}</p>}
      {nothing && <p className="panel-freshness">Nothing in the guide matches “{query.trim()}”.</p>}

      {!searching && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Start here</CardTitle></CardHeader>
          <CardContent><ul className="help-list">{START_HERE.map((line) => <li key={line}>{line}</li>)}</ul></CardContent>
        </Card>
      )}

      {panels.length > 0 && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Panels you can open</CardTitle></CardHeader>
          <CardContent>
            <ul className="help-panels">
              {panels.map((panel) => (
                <li key={panel.type}>
                  <div className="help-panels-head">
                    <strong>{panel.title}</strong>
                    <Button size="xs" variant="outline" aria-label={`Open ${panel.title}`} onClick={() => open(panel.command)}>Open</Button>
                  </div>
                  <p>{PANEL_GUIDES[panel.type].oneLine}</p>
                  <p>Type <code>{PANEL_GUIDES[panel.type].usage}</code></p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {commands.length > 0 && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Other commands</CardTitle></CardHeader>
          <CardContent>
            <Table className="help-table">
              <TableBody>
                {commands.map((item) => <TableRow key={item.usage}><TableCell><code>{item.usage}</code></TableCell><TableCell>{item.meaning}</TableCell></TableRow>)}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {shortcuts.length > 0 && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Keyboard shortcuts</CardTitle></CardHeader>
          <CardContent>
            <Table className="help-table">
              <TableBody>
                {shortcuts.map((item) => <TableRow key={item.keys}><TableCell><kbd>{item.keys}</kbd></TableCell><TableCell>{item.action}</TableCell></TableRow>)}
              </TableBody>
            </Table>
            <p className="panel-freshness">{SHORTCUT_NOTE}</p>
          </CardContent>
        </Card>
      )}

      {panels.length > 0 && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Reading each panel</CardTitle></CardHeader>
          <CardContent>
            {panels.map((panel) => (
              <details key={panel.type} className="help-details" open={searching}>
                <summary><strong>{panel.title}</strong> · {PANEL_GUIDES[panel.type].oneLine}</summary>
                <PanelGuide kind={panel.type} />
              </details>
            ))}
          </CardContent>
        </Card>
      )}

      {statuses.length > 0 && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Status labels</CardTitle></CardHeader>
          <CardContent>
            <dl className="help-terms">{statuses.map(([label, meaning]) => <div key={label}><dt>{label}</dt><dd>{meaning}</dd></div>)}</dl>
          </CardContent>
        </Card>
      )}

      {terms.length > 0 && (
        <Card className="terminal-card">
          <CardHeader><CardTitle className="side-card-title">Glossary</CardTitle></CardHeader>
          <CardContent>
            <dl className="help-terms">{terms.map(([term, meaning]) => <div key={term}><dt>{term}</dt><dd>{meaning}</dd></div>)}</dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
