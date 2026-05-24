/**
 * Manual smoke runner for save2edge/save2repo.
 *
 * Required env:
 * - CLOUD_API_BASE_URL (e.g. https://app.jsonpages.io/api/v1)
 * - TENANT_API_KEY
 *
 * Optional env:
 * - TEST_SLUG (default: home)
 */
const baseUrl = process.env.CLOUD_API_BASE_URL?.trim();
const apiKey = process.env.TENANT_API_KEY?.trim();
const slug = process.env.TEST_SLUG?.trim() || "home";

if (!baseUrl || !apiKey) {
  console.error("Missing CLOUD_API_BASE_URL or TENANT_API_KEY");
  process.exit(1);
}

async function main() {
  const correlationId = `smoke-${Date.now()}`;

  console.info("[save2-smoke] save2edge start", { baseUrl, slug, correlationId });
  const edgeRes = await fetch(`${baseUrl.replace(/\/$/, "")}/save2edge`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify({
      slug,
      type: "page",
      data: {
        meta: { title: `Smoke ${new Date().toISOString()}` },
        sections: [],
      },
    }),
  });
  const edgeBody = await edgeRes.json().catch(() => ({}));
  console.info("[save2-smoke] save2edge response", { status: edgeRes.status, body: edgeBody });
  if (!edgeRes.ok) {
    throw new Error(`save2edge failed: ${edgeRes.status}`);
  }

  console.info("[save2-smoke] save2repo start", { correlationId });
  const repoRes = await fetch(`${baseUrl.replace(/\/$/, "")}/save2repo`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify({
      message: "Smoke Sync [build]",
    }),
  });
  if (!repoRes.ok || !repoRes.body) {
    const body = await repoRes.json().catch(() => ({}));
    throw new Error(`save2repo failed: ${repoRes.status} ${JSON.stringify(body)}`);
  }

  const reader = repoRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneSeen = false;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data = line.slice(5).trim();
      }
      const parsed = (() => {
        try {
          return JSON.parse(data);
        } catch {
          return { raw: data };
        }
      })();
      console.info("[save2-smoke] sse", { event, data: parsed });
      if (event === "done") doneSeen = true;
      if (event === "error") {
        throw new Error(`save2repo emitted error: ${data}`);
      }
    }
  }

  if (!doneSeen) {
    throw new Error("save2repo stream ended without done event");
  }

  console.info("[save2-smoke] completed");
}

main().catch((error) => {
  console.error("[save2-smoke] failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

