// Reads one scenario's step evidence from Cucumber's JSON report.
import { lstatSync, readFileSync } from "node:fs";
import { REVIEWED_FEATURE_PATH } from "./reviewed-scenarios";
import { MAX_CUCUMBER_REPORT_STEPS } from "./limits";

export type CucumberStepStatus =
  | "passed"
  | "failed"
  | "skipped"
  | "pending"
  | "undefined"
  | "ambiguous"
  | "unknown";

export interface CucumberScenarioEvidence {
  readonly featureName: string;
  readonly scenarioName: string;
  readonly steps: readonly {
    readonly name: string;
    readonly status: CucumberStepStatus;
  }[];
}

const MAX_CUCUMBER_REPORT_BYTES = 256_000;

export function cucumberScenarioEvidence(
  reportPath: string,
  expectedScenarioId: string,
): CucumberScenarioEvidence | undefined {
  try {
    const reportFile = lstatSync(reportPath);
    if (
      !reportFile.isFile() ||
      reportFile.isSymbolicLink() ||
      reportFile.size > MAX_CUCUMBER_REPORT_BYTES
    ) {
      return undefined;
    }
    const features = JSON.parse(readFileSync(reportPath, "utf8")) as {
      name?: string;
      uri?: string;
      elements?: {
        type?: string;
        name?: string;
        tags?: { name?: string }[];
        steps?: { name?: string; result?: { status?: string } }[];
      }[];
    }[];
    const scenarios = features.flatMap((feature) =>
      (feature.elements ?? [])
        .filter((element) => element.type === "scenario")
        .map((scenario) => ({ feature, scenario })),
    );
    if (scenarios.length !== 1) {
      return undefined;
    }
    const { feature, scenario } = scenarios[0];
    if (
      feature.uri !== REVIEWED_FEATURE_PATH ||
      !scenario.tags?.some(
        (tag) => tag.name === `@scenario-id=${expectedScenarioId}`,
      )
    ) {
      return undefined;
    }
    const businessSteps =
      scenario.steps?.filter(
        (step): step is typeof step & { name: string } =>
          typeof step.name === "string",
      ) ?? [];
    if (
      typeof feature.name !== "string" ||
      feature.name.length > 300 ||
      typeof scenario.name !== "string" ||
      scenario.name.length > 300 ||
      businessSteps.length === 0 ||
      businessSteps.length > MAX_CUCUMBER_REPORT_STEPS ||
      businessSteps.some((step) => step.name.length > 300)
    ) {
      return undefined;
    }
    const statuses: readonly CucumberStepStatus[] = [
      "passed",
      "failed",
      "skipped",
      "pending",
      "undefined",
      "ambiguous",
    ];
    return {
      featureName: feature.name,
      scenarioName: scenario.name,
      steps: businessSteps.map((step) => ({
        name: step.name,
        status: statuses.includes(step.result?.status as CucumberStepStatus)
          ? (step.result?.status as CucumberStepStatus)
          : "unknown",
      })),
    };
  } catch {
    return undefined;
  }
}
