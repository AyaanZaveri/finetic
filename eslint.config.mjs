import jest from "eslint-plugin-jest";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import nextVitals from "eslint-config-next/core-web-vitals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  ...compat.extends("eslint:recommended"),
  ...nextVitals,
  {
    ignores: [".next/**", "out/**", "build/**", "next-env.d.ts", "mobile/**"],
  },
  {
    plugins: {
      jest,
    },

    languageOptions: {
      globals: {
        ...globals.node,
        ...jest.environments.globals.globals,
      },

      ecmaVersion: "latest",
      sourceType: "module",
    },

    rules: {
      "prefer-const": "error",
      "no-var": "error",

      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      indent: ["error", 4],

      "space-before-function-paren": [
        "warn",
        {
          anonymous: "always",
          named: "never",
        },
      ],

      semi: ["warn", "always"],
    },
  },
];
