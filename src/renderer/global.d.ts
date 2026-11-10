/// <reference types="vite/client" />

import type { HyperdeckApi } from "../shared/api";

declare global {
  interface Window {
    hyperdeck: HyperdeckApi;
  }
}
