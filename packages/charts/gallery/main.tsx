/**
 * Gallery entry — renders the chart story matrix for ?lang=en|ar.
 * Sets document lang/dir per the locale contract (real attributes).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fixtureLocalization, type FixtureLocale } from "../src/dev-localization.ts";
import { Gallery } from "./stories.tsx";
import "../src/styles.css";
import "./gallery.css";

const params = new URLSearchParams(location.search);
const locale: FixtureLocale = params.get("lang") === "ar" ? "ar" : "en";
document.documentElement.lang = locale;
document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";

const host = document.getElementById("root");
if (!host) throw new Error("gallery root missing");

createRoot(host).render(
  <StrictMode>
    <Gallery locale={locale} localization={fixtureLocalization(locale)} />
  </StrictMode>,
);
