import type { Metadata } from "next";

import { Header } from "@/components/Header";
import { I18nProvider } from "@/i18n/I18nProvider";
import { getRequestLocale } from "@/i18n/server";

import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();

  return {
    title: {
      default: "Conclavia",
      template: "%s · Conclavia",
    },
    description:
      locale === "it"
        ? "Un collega digitale con avatar per meeting singoli e ricorrenti."
        : "A digital colleague with an avatar for single and recurring meetings.",
  };
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();

  return (
    <html lang={locale}>
      <body>
        <I18nProvider initialLocale={locale}>
          <Header />
          <main>{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
