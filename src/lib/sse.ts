export type SSEMessage = {
  event: string;
  data: string;
};

export async function readSSE(
  response: Response,
  onMessage: (message: SSEMessage) => void,
  options?: { signal?: AbortSignal }
) {
  const body = response.body;
  if (!body) {
    throw new Error("Response body is empty.");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let currentEvent = "message";
  let dataLines: string[] = [];

  const flush = () => {
    if (!dataLines.length && currentEvent === "message") return;
    onMessage({ event: currentEvent, data: dataLines.join("\n") });
    currentEvent = "message";
    dataLines = [];
  };

  while (true) {
    if (options?.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        // ignore
      }
      break;
    }

    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\n/);
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (!line) {
        flush();
        continue;
      }

      if (line.startsWith(":")) {
        continue;
      }

      if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim() || "message";
        continue;
      }

      if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
        continue;
      }
    }
  }

  flush();
}

