// Los tests son de funciones puras (parser, ranking, normalización, hashing),
// así que corren en Node directo. La integración con D1/workerd se prueba con `wrangler dev`.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
