/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RUNTIME_ARN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
