import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@nf/shared", "@nf/sim", "@nf/render"],
  agentRules: false,
  devIndicators: false,
};

export default nextConfig;
