import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@nodeops-createos/sandbox"],
};

export default nextConfig;
