import type { OwnedLocalLabels } from "../../../src/execution/owned-local-labels";
import type { Browser, BrowserContext, Page } from "@playwright/test";

export interface ExecutionPayload {
  readonly scenario: {
    readonly id: string;
    readonly values: Readonly<Record<string, string | number | boolean>>;
  };
  readonly environment: {
    readonly approvedOrigin: string;
    readonly initialTargetUrl: string;
  };
  readonly redirectTargetUrl: string;
  readonly ownedLocalLabels?: Partial<OwnedLocalLabels>;
}

export interface ExecutionWorld {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  payload?: ExecutionPayload;
  blockedDestinations: string[];
  redirectNavigationBlocked?: boolean;
}
