import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libpg-query는 WASM 파일을 상대 경로로 로드한다. 번들링하면 경로가 깨지므로 node_modules에서 그대로 불러온다.
  serverExternalPackages: ["libpg-query"],
  // 런타임에 fs로 읽는 파일은 서버리스 번들(Vercel)에 명시적으로 포함한다.
  outputFileTracingIncludes: {
    "/api/agent": ["./prompts/**/*", "./node_modules/libpg-query/wasm/**/*"],
    "/api/health": ["./node_modules/libpg-query/wasm/**/*"],
  },
  cacheComponents: true,
  partialPrefetching: true,
  // Git 빌드의 한글 경로에서 Turbopack source-map이 패닉한다. 배포는 Next 내장 Webpack을 사용한다.
  webpack(config) {
    config.module.rules.push({ test: /globals\.css$/, enforce: "pre", use: ["@tailwindcss/turbopack"] });
    return config;
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
