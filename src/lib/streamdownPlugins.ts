import { createCodePlugin } from "@streamdown/code";
import { cjk } from "@streamdown/cjk";
import { createMermaidPlugin } from "@streamdown/mermaid";

export const streamdownPlugins = {
  code: createCodePlugin({
    themes: ["vitesse-light", "vitesse-dark"],
  }),
  cjk,
  mermaid: createMermaidPlugin({
    config: {
      fontSize: 16,
    },
  }),
};
