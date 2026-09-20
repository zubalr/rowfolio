import { createElement } from "react";
import { createRoot } from "react-dom/client";

// Bootstrap shell entry. The localized landing content is delivered by the
// landing task owner; this entry proves the React/TS/Vite build path for both
// static locale entries and intentionally mounts only a minimal status line.
const arabic = document.documentElement.lang === "ar";

const copy = arabic
  ? { name: "روفوليو", note: "نسخة تطويرية — التطبيق قيد الإنشاء." }
  : { name: "Rowfolio", note: "Development build — the application is under construction." };

const host = document.getElementById("root");
if (host) {
  createRoot(host).render(
    createElement(
      "main",
      null,
      createElement("h1", null, copy.name),
      createElement("p", null, copy.note),
    ),
  );
}
