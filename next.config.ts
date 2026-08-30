import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo is presented from `next dev`, and the dev overlay's badge sits on
  // top of the agent's input box in the bottom-left corner. Compile and runtime
  // errors are still reported in the terminal.
  devIndicators: false,
  // `lib/agent/skills` is read as trusted text at runtime. Keep the canonical
  // SKILL.md in traced server deployments instead of duplicating it in code.
  outputFileTracingIncludes: {
    "/api/chat": ["./lib/agent/skills/**/*.md"],
  },
};

export default nextConfig;
