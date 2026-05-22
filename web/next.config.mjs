/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow Server Components to read from the parent project's Prisma client
    // without bundling it. Necessary because the @prisma/client install lives
    // in ../node_modules.
    externalDir: true,
  },
  images: { unoptimized: true },
};

export default nextConfig;
