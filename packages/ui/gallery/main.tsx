/**
 * Gallery entry — renders the story matrix for ?lang=en|ar.
 * Sets document lang/dir per the locale contract (real attributes, not CSS).
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../src/fonts.ts";
import { directionOf, type LocaleCode } from "../src/index.ts";
import { Gallery } from "./stories.tsx";
import "./gallery.css";

const params = new URLSearchParams(location.search);
const locale: LocaleCode = params.get("lang") === "ar" ? "ar" : "en";
document.documentElement.lang = locale;
document.documentElement.dir = directionOf(locale);

const host = document.getElementById("root");
if (!host) throw new Error("gallery root missing");

createRoot(host).render(
  <StrictMode>
    <Gallery locale={locale} />
  </StrictMode>,
);
