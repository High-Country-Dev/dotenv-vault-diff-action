import * as core from "@actions/core";
import * as github from "@actions/github";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function run(): Promise<void> {
  try {
    const githubToken = core.getInput("github-token", { required: true });
    const dotenvMe = core.getInput("dotenv-me", { required: true });

    const octokit = github.getOctokit(githubToken);
    const context = github.context;

    if (!dotenvMe) {
      core.setFailed("DOTENV_ME is not set. Exiting.");
      return;
    }

    process.env.DOTENV_ME = dotenvMe;

    async function getLatestVersion(stage: string): Promise<string> {
      try {
        const { stdout } = await execAsync(
          `dotenv-vault versions ${stage} | awk 'NR==3 { printf "%5s %s", $1, $2 }'`
        );
        return stdout.trim();
      } catch (error) {
        console.error(`Error getting latest version for ${stage}:`, error);
        return "";
      }
    }

    async function generateCommentBody(): Promise<string> {
      const { stdout: diffOutput } = await execAsync(
        `git diff origin/${process.env.GITHUB_BASE_REF} -- .env.vault`
      );
      const stages = ["CI", "DEVELOPMENT", "STAGING", "PRODUCTION"];
      const changedStages = stages.filter((stage) =>
        diffOutput.includes(`+DOTENV_VAULT_${stage}`)
      );

      if (changedStages.length === 0) {
        return "Dotenv-vault Diff\n\nNo changes detected in .env.vault file.";
      }

      const versionOutputs = await Promise.all(
        changedStages.map(async (stage) => {
          const version = await getLatestVersion(stage.toLowerCase());
          return version ? `\n${stage}:\n${version}` : "";
        })
      );

      return `Dotenv-vault Diff\n${versionOutputs.join("\n")}`.trim();
    }

    const commentBody = await generateCommentBody();

    const { data: comments } = await octokit.rest.issues.listComments({
      ...context.repo,
      issue_number: context.issue.number,
    });

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
