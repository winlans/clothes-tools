/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BAIDU_TONGJI_SITE_ID?: string;
}

declare module "@mupdf-wasm?url" {
  const url: string;
  export default url;
}
