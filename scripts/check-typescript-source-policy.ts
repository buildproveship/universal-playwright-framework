import { execFileSync } from "node:child_process";
import path from "node:path";

const JAVASCRIPT_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".cjs"]);
const GENERATED_OR_VENDOR_ROOT_DIRECTORIES = new Set([
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
  "__generated__",
  "allure-report",
  "allure-results",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
  "third-party",
  "third_party",
  "vendor",
  "vendors",
]);

export function findAuthoredJavaScriptPaths(
  filePaths: readonly string[],
): string[] {
  return filePaths
    .map((filePath) => filePath.replace(/\\/g, "/"))
    .filter((filePath) => {
      const segments = filePath.split("/");
      const fileName = segments.at(-1) ?? "";
      const extension = path.posix.extname(fileName).toLowerCase();

      if (!JAVASCRIPT_EXTENSIONS.has(extension)) {
        return false;
      }

      if (
        segments.some((segment) => segment.toLowerCase() === "node_modules") ||
        GENERATED_OR_VENDOR_ROOT_DIRECTORIES.has(
          (segments[0] ?? "").toLowerCase(),
        )
      ) {
        return false;
      }

      return !/\.(?:generated|gen|min)\.(?:js|jsx|mjs|cjs)$/i.test(fileName);
    })
    .sort((left, right) => {
      // Preserve the original locale-independent UTF-16 code-unit ordering.
      if (left < right) return -1;
      return Number(left > right);
    });
}

/**
 * Git is never resolved through PATH. Custom/Nix/non-C Windows installations
 * must set PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE to a trusted absolute executable.
 * This configuration is a trust boundary, not an ownership/ACL safety check.
 */
export function resolveGitExecutable(
  platform: NodeJS.Platform = process.platform,
  configured: string | undefined = process.env
    .PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE,
): string {
  if (configured !== undefined) {
    const absolute =
      platform === "win32"
        ? path.win32.isAbsolute(configured) && /^[a-z]:[\\/]/i.test(configured)
        : path.posix.isAbsolute(configured);
    if (!absolute || configured.includes("\0")) {
      throw new Error(
        "PLAYWRIGHT_FRAMEWORK_GIT_EXECUTABLE must be a trusted absolute local executable path",
      );
    }
    return configured;
  }
  if (platform === "win32") return "C:\\Program Files\\Git\\cmd\\git.exe";
  if (platform === "freebsd") return "/usr/local/bin/git";
  return "/usr/bin/git";
}

function listRepositoryFiles(): string[] {
  const gitExecutable = resolveGitExecutable();
  const repositoryRoot = execFileSync(
    gitExecutable,
    ["rev-parse", "--show-toplevel"],
    {
      encoding: "utf8",
    },
  ).trim();
  const fileList = execFileSync(
    gitExecutable,
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: repositoryRoot },
  );

  return fileList.toString("utf8").split("\0").filter(Boolean);
}

function main(): void {
  const authoredJavaScript = findAuthoredJavaScriptPaths(listRepositoryFiles());

  if (authoredJavaScript.length > 0) {
    console.error(
      "TypeScript source policy failed. Convert authored JavaScript files to TypeScript:",
    );
    for (const filePath of authoredJavaScript) {
      console.error(`  ${filePath}`);
    }
    console.error(
      "Generated build output and vendor directories are excluded; configuration files are not implicitly exempt.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "TypeScript source policy passed: no authored JavaScript files found.",
  );
}

if (require.main === module) {
  main();
}
