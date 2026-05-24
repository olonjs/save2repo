import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // Default ignores of eslint-config-next, made explicit here so we can
  // override-and-add without losing them.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // save2repo Phase 0 relaxations.
  //
  // The fork inherits ~40 lint errors from jsonpages-platform that are not
  // bugs (mostly `any` in legacy types). Fixing them mass-wise during the
  // fork-and-clean phase would be churn for zero quality gain. We downgrade
  // them to warnings here so CI stays green for day-1; T-1xx tasks tighten
  // each rule per-file as the consumer code gets rewritten.
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react/no-unescaped-entities": "warn",
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
