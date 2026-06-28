import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/cuzdan/yukle",
        destination: "/cuzdan?topup=1",
        permanent: false,
      },
      {
        source: "/sepet",
        destination: "/?cart=open",
        permanent: false,
      },
      {
        source: "/giris",
        destination: "/?auth=login",
        permanent: false,
      },
      {
        source: "/isletmeler/:businessId/menu",
        destination: "/isletmeler/:businessId",
        permanent: false,
      },
      {
        source: "/isletme/:businessId/yonetim/:section",
        destination: "/isletme/:businessId?panel=:section",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
