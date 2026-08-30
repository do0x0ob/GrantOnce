import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The demo is presented from `next dev`, and the dev overlay's badge sits on
  // top of the agent's input box in the bottom-left corner. Compile and runtime
  // errors are still reported in the terminal.
  devIndicators: false,
};

export default nextConfig;
