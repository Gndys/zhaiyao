import { source } from "@/lib/source";
import { createFromSource } from "fumadocs-core/search/server";

export const { GET } = createFromSource(source, {
  // https://docs.orama.com/open-source/supported-languages
  language: "english",
  // Orama does not provide a Chinese tokenizer; map zh to the english one to avoid build-time errors.
  localeMap: {
    zh: "english",
  },
});
