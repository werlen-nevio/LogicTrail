import type { LogicTrailConfig } from "logictrail";

export default {
  ignore: ["**/*.test.ts", "prisma/**"],
  maxDepth: 12,
  outputDir: ".logictrail",
} satisfies LogicTrailConfig;
