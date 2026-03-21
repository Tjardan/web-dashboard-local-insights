// Temporary test script to debug chat session loading
import { listSessions } from "../packages/chat-mcp/dist/index.js";

try {
  const sessions = await listSessions({
    workspaceFilter: "C:/Projects/beatsaber-custom-maps",
    limit: 5,
    includeIndexableText: true,
  });
  console.log("Success! Got", sessions.length, "sessions");
  sessions.forEach((s) =>
    console.log(`  - [${s.id.slice(0, 8)}] ${s.title} (${s.workspace})`),
  );
} catch (err) {
  console.error("Error:", err.message);
  console.error(err.stack?.split("\n").slice(0, 10).join("\n"));
}
