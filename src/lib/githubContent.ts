import {
  getInstallationOctokit,
  GithubInstallationTokenError,
} from "@/lib/githubAppClient";

// ----------------------------------------------------------------------------
// GitHub Contents API helpers (T-107).
//
// save2repo's editor reads tenant content directly from the buyer's GitHub
// repo (no central content store — ADR-005). All calls go through
// githubAppClient.getInstallationOctokit which transparently mints a
// short-lived installation token via the olonjs token-signing endpoint
// (ADR-006).
//
//   readContent(installationId, owner, repo, path, ref?)
//     → { content, sha, encoding } — UTF-8 string + SHA needed for the
//       next write (GitHub's optimistic concurrency).
//
//   writeContent(installationId, owner, repo, path, { content, message, sha?, branch?, committer? })
//     → { sha } — PUT /repos/{owner}/{repo}/contents/{path}. If sha omitted,
//       this creates a new file; if provided, updates the existing one.
//
//   deleteContent(installationId, owner, repo, path, { message, sha, branch?, committer? })
//     → { ok: true } — DELETE for the same endpoint.
//
// Errors:
//   - 404 on read → ContentNotFoundError (separate type so callers can
//     distinguish "file not yet created" from real failures).
//   - GithubInstallationTokenError bubbles up from the client wrapper.
//   - Other GitHub errors wrap into ContentApiError with status + body excerpt.
// ----------------------------------------------------------------------------

export class ContentNotFoundError extends Error {
  constructor(public readonly path: string) {
    super(`Content not found: ${path}`);
    this.name = "ContentNotFoundError";
  }
}

export class ContentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ContentApiError";
  }
}

export type ReadContentResult = {
  /** Decoded UTF-8 content. */
  content: string;
  /** Blob SHA — pass back to writeContent to update without overwriting concurrent edits. */
  sha: string;
  /** Original encoding from GitHub (usually "base64"). */
  encoding: "base64" | "utf-8";
};

export async function readContent(
  installationId: number,
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): Promise<ReadContentResult> {
  const octokit = await getInstallationOctokit(installationId);
  try {
    const res = await octokit.request(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo,
        path,
        ...(ref ? { ref } : {}),
      },
    );
    const data = res.data;
    if (Array.isArray(data) || data.type !== "file") {
      throw new ContentApiError(
        500,
        "ERR_CONTENT_NOT_FILE",
        `Path ${path} does not point to a single file (type=${Array.isArray(data) ? "dir" : data.type})`,
      );
    }
    const encoding = data.encoding === "base64" ? "base64" : "utf-8";
    const decoded =
      encoding === "base64"
        ? Buffer.from(data.content, "base64").toString("utf-8")
        : data.content;
    return { content: decoded, sha: data.sha, encoding };
  } catch (err) {
    if (err instanceof GithubInstallationTokenError) throw err;
    if (err instanceof ContentApiError) throw err;
    // Octokit RequestError exposes .status
    const status = (err as { status?: number }).status;
    if (status === 404) throw new ContentNotFoundError(path);
    const message = err instanceof Error ? err.message : "Unknown GitHub error";
    throw new ContentApiError(status ?? 500, "ERR_CONTENT_READ_FAILED", message);
  }
}

export type WriteContentOptions = {
  /** UTF-8 string to write. */
  content: string;
  /** Commit message. */
  message: string;
  /** SHA of the existing blob (required for updates; omit to create). */
  sha?: string;
  /** Branch to commit on. Defaults to the repo default. */
  branch?: string;
  /** Optional committer override (defaults to the App's identity, "save2repo[bot]"). */
  committer?: { name: string; email: string };
};

export async function writeContent(
  installationId: number,
  owner: string,
  repo: string,
  path: string,
  opts: WriteContentOptions,
): Promise<{ sha: string }> {
  const octokit = await getInstallationOctokit(installationId);
  try {
    const res = await octokit.request(
      "PUT /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo,
        path,
        message: opts.message,
        content: Buffer.from(opts.content, "utf-8").toString("base64"),
        ...(opts.sha ? { sha: opts.sha } : {}),
        ...(opts.branch ? { branch: opts.branch } : {}),
        ...(opts.committer ? { committer: opts.committer } : {}),
      },
    );
    const newSha = res.data.content?.sha;
    if (!newSha) {
      throw new ContentApiError(
        500,
        "ERR_CONTENT_WRITE_NO_SHA",
        "GitHub returned 200 but no content.sha",
      );
    }
    return { sha: newSha };
  } catch (err) {
    if (err instanceof GithubInstallationTokenError) throw err;
    if (err instanceof ContentApiError) throw err;
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : "Unknown GitHub error";
    throw new ContentApiError(status ?? 500, "ERR_CONTENT_WRITE_FAILED", message);
  }
}

export type DeleteContentOptions = {
  message: string;
  sha: string;
  branch?: string;
  committer?: { name: string; email: string };
};

export async function deleteContent(
  installationId: number,
  owner: string,
  repo: string,
  path: string,
  opts: DeleteContentOptions,
): Promise<{ ok: true }> {
  const octokit = await getInstallationOctokit(installationId);
  try {
    await octokit.request(
      "DELETE /repos/{owner}/{repo}/contents/{path}",
      {
        owner,
        repo,
        path,
        message: opts.message,
        sha: opts.sha,
        ...(opts.branch ? { branch: opts.branch } : {}),
        ...(opts.committer ? { committer: opts.committer } : {}),
      },
    );
    return { ok: true };
  } catch (err) {
    if (err instanceof GithubInstallationTokenError) throw err;
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : "Unknown GitHub error";
    throw new ContentApiError(status ?? 500, "ERR_CONTENT_DELETE_FAILED", message);
  }
}
