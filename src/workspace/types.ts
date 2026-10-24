export type PanelParams = {
  kind: string;
  commodity?: string;
  region?: string;
  linkGroup?: string;
  workspaceName?: string;
  /** Move explainer sensitivity in standard deviations. */
  threshold?: number;
};

export type PanelApiLike = {
  setTitle(title: string): void;
  updateParameters(params: Record<string, unknown>): void;
};

export type PanelComponentProps = { api: PanelApiLike; params: PanelParams };
