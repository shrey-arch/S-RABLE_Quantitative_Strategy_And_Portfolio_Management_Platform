/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin. Empty = same origin (dev proxy / FastAPI-served build). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
