import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Data is supplied at runtime from persistent storage, never packaged in a build.
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./.env*"] },
};
export default config;
