import { defineTool } from "../definition.js";
import { fileStatTool } from "../system-artifact-tools.js";

export default defineTool({
  name: "file_stat",
  run: fileStatTool,
  emoji: "📌",
  description: "Filesystem stat for one workspace path (`size`, mtimes, directory flag).",
  inputSchema: { type: "object", properties: {}, additionalProperties: true },
});
