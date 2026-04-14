import type { NextConfig } from "next";
import { resolve } from "path";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.138"],
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: resolve(import.meta.dirname),
  },
};

export default nextConfig;
