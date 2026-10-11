import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // static export so the game can be hosted on Cloudflare Pages (or any static host)
  output: "export",
  images: { unoptimized: true },
  transpilePackages: ["@nf/shared", "@nf/sim", "@nf/render"],
  agentRules: false,
  devIndicators: false,
};

export default nextConfig;
