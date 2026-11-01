export type PanelParams = {
  kind: string;
  commodity?: string;
  region?: string;
  linkGroup?: string;
  workspaceName?: string;
  /** Move explainer sensitivity in standard deviations. */
  threshold?: number;
  /** Raw data panel selection: a source, and one of its series or a commodity for weather and news. */
  sourceId?: string;
  dataset?: string;
  /** River panels: the gauge id from config/waterways.json. */
  gauge?: string;
  /** Plain wording for a reader, such as "farmer" on the river panel. */
  audience?: string;
};

export type PanelApiLike = {
  setTitle(title: string): void;
  updateParameters(params: Record<string, unknown>): void;
};

export type PanelComponentProps = { api: PanelApiLike; params: PanelParams };
