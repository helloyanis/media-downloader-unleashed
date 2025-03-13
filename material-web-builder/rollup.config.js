import resolve from "rollup-plugin-node-resolve";
import { terser } from "rollup-plugin-terser";

export default {
  input: "src/main.js", // Entry point
  output: {
    file: "dist/bundle.js", // Output file
    format: "esm", // ES Modules
  },
  plugins: [
    resolve(), // Allows Rollup to bundle modules from node_modules
    terser(), // Minify for smaller bundle size
  ],
};
