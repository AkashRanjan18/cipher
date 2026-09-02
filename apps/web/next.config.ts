import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 writes its own CLAUDE.md and AGENTS.md into this directory on
  // every dev start. The project already has one at the repo root and a
  // second file in a subdirectory would load alongside it and dilute it with
  // generic framework guidance.
  agentRules: false,
};

export default nextConfig;
