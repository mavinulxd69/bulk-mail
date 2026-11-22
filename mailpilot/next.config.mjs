// bodySizeLimit: CSV imports are uploaded through a Server Action (2 MB file cap enforced in the action, with headroom for the form).
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
};
export default nextConfig;
