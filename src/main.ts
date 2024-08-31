import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec } from "child_process";
import { promisify } from "util";

interface VaultEnvVersion {
  version: string;
  fields: string;
  user: string;
  time: string;
}

interface PullRequest {
  number: number;
  title: string;
  base: { ref: string };
  head: { ref: string };
}

const execAsync = promisify(exec);

const STAGES = ["CI", "DEVELOPMENT", "STAGING", "PRODUCTION"];

async function run(): Promise<void> {
  try {
    const githubToken =
      process.env.GITHUB_TOKEN ?? core.getInput("github-token");
    const dotenvMe = process.env.DOTENV_ME ?? core.getInput("dotenv-me");

    if (!githubToken) {
      core.setFailed("GITHUB_TOKEN is not set. Exiting.");
      return;
    }

    if (!dotenvMe) {
      core.setFailed("DOTENV_ME is not set. Exiting.");
      return;
    }

    const prNumber = process.env.PR_NUMBER; // or null

    const octokit = github.getOctokit(githubToken);
    const context = github.context;
    const repo = context.repo;

    console.log("repo:", repo);

    let currentPR: PullRequest;
    if (context.payload.pull_request) {
      currentPR = context.payload.pull_request as PullRequest;
    } else if (typeof prNumber === "string") {
      const { data: pr } = await octokit.rest.pulls.get({
        ...repo,
        pull_number: parseInt(prNumber, 10),
      });
      currentPR = pr as PullRequest;
    } else {
      core.setFailed("Could not determine pull request number. Exiting.");
      return;
    }

    console.log("currentPR:", currentPR.number);

    if (!dotenvMe) {
      core.setFailed("DOTENV_ME is not set. Exiting.");
      return;
    }

    process.env.DOTENV_ME = dotenvMe;

    async function getAllVersions(stage: string): Promise<VaultEnvVersion[]> {
      try {
        const { stdout } = await execAsync(
          `npx dotenv-vault versions ${stage}`
        );
        const versionLines = stdout.split("\n").slice(2); // Skip the header lines
        const allVersions = versionLines
          .filter((line) => line.trim() !== "")
          .map((line) => {
            const parts = line.trim().split(/\s{2,}/); // Split by two or more spaces
            const userTime = parts.pop();
            const [user, ...timeParts] = userTime?.split(" ") ?? [];
            const time = timeParts.join(" ");
            const version = parts.splice(0, 1)?.[0]?.replace("v", ""); // Get the version number
            const fields = parts.length ? parts[0] : "N/A"; // Join remaining fields as a single string

            return {
              version,
              fields,
              user,
              time,
            };
          })
          .filter((version) => !!version.version);
        // console.log(`Versions for ${stage}:`, allVersions);
        return allVersions;
      } catch (error) {
        console.error(`Error getting versions for ${stage}:`, error);
        return [];
      }
    }

    async function getChangedStageVersions() {
      const { stdout: diffOutput } = await execAsync(
        `git diff origin/${process.env.GITHUB_BASE_REF} -- .env.vault`
      );

      const changedStages = STAGES.filter(
        (stage) =>
          diffOutput.includes(`+DOTENV_VAULT_${stage}`) ||
          diffOutput.includes(`-DOTENV_VAULT_${stage}`)
      );

      if (changedStages.length === 0) {
        return [];
      }

      const stageVersions = changedStages.map((stage) => {
        const addedRegex = new RegExp(
          `\\+DOTENV_VAULT_${stage}_VERSION=(\\d+)`,
          "g"
        );
        const removedRegex = new RegExp(
          `\\-DOTENV_VAULT_${stage}_VERSION=(\\d+)`,
          "g"
        );

        let match;
        const addedVersions = [];
        while ((match = addedRegex.exec(diffOutput)) !== null) {
          addedVersions.push(parseInt(match[1]));
        }

        const removedVersions = [];
        while ((match = removedRegex.exec(diffOutput)) !== null) {
          removedVersions.push(parseInt(match[1]));
        }

        const minRemovedVersion = Math.min(...removedVersions);
        const maxAddedVersion = Math.max(...addedVersions);

        return {
          stage,
          versions: Array.from(
            { length: maxAddedVersion - minRemovedVersion },
            (_, i) => minRemovedVersion + i + 1
          ),
        };
      });

      return stageVersions;
    }

    async function generateCommentBody(): Promise<string> {
      const changedStageVersions = await getChangedStageVersions();
      console.log("Changed stage versions:", changedStageVersions);

      const versionOutputs = await Promise.all(
        STAGES.map(async (stage) => {
          const changedVersion = changedStageVersions.find(
            (changedStage) => changedStage.stage === stage
          );
          if (!changedVersion) {
            return `${stage}: No changes`;
          }
          const versions = await getAllVersions(stage);
          console.log(
            `Versions for ${stage}:`,
            versions.map((v) => v.version)
          );
          const changedVersions = versions.filter((version) =>
            changedVersion.versions.includes(parseInt(version.version, 10))
          );
          if (changedVersions.length === 0) {
            return `${stage}: No versions changed`;
          }
          return changedVersions
            .map((cv) => `${stage} (${cv.version}): \`${cv.fields}\``)
            .join("\n");
        })
      );

      return `Dotenv-vault Diff\n${versionOutputs.join("\n")}`;
    }

    const commentBody = await generateCommentBody();

    console.log("Comment body:", commentBody);

    const { data: comments } = await octokit.rest.issues.listComments({
      ...context.repo,
      issue_number: currentPR.number,
    });

    console.log("Comments:", comments.length);

    const existingComment = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.body?.startsWith("Dotenv-vault Diff")
    );

    const commentParams = {
      ...context.repo,
      body: commentBody,
    };

    if (existingComment) {
      await octokit.rest.issues.updateComment({
        ...commentParams,
        comment_id: existingComment.id,
      });
      console.log("Updated existing comment");
    } else {
      await octokit.rest.issues.createComment({
        ...commentParams,
        issue_number: context.issue.number,
      });
      console.log("Created new comment");
    }
  } catch (error) {
    core.setFailed(
      error instanceof Error ? error.message : "An error occurred"
    );
  }
}

run();
