import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only packages used by the pipeline stay out of the bundle.
  serverExternalPackages: ["sharp", "mathjs", "adm-zip"],
};

export default nextConfig;
