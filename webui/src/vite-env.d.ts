/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** mock | real，缺省 real */
  readonly VITE_API_MODE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
