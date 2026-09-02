import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 writes per-directory agent instruction files on every dev start.
  // This project keeps its own documentation at the repo root; a generated
  // second copy in a subdirectory only dilutes it.
  agentRules: false,
};

export default nextConfig;
