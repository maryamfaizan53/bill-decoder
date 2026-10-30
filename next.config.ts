import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native / Node-only packages used by the pipeline stay out of the bundle.
  serverExternalPackages: ["sharp", "mathjs", "adm-zip"],
  // Sample bills and their saved results are read from disk at runtime; make sure
  // they are bundled with the serverless functions on Vercel.
  outputFileTracingIncludes: {
    "/": ["./samples/**/*"],
    "/api/**/*": ["./samples/**/*"],
    "/bill/**/*": ["./samples/**/*"],
  },
};

export default nextConfig;
