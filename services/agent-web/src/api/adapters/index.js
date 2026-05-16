import { INTEGRATION_MODE } from "../../config";
import { ADAPTER_MODES } from "./types";
import { createStandaloneAdapter } from "./standaloneAdapter";
import { createAgdAdapter } from "./agdAdapter";

let cached = null;

/**
 * Returns the singleton apiAdapter for the configured integration mode.
 * The choice is fixed at boot and does not change at runtime — toggling
 * `VITE_INTEGRATION_MODE` requires a rebuild + restart.
 */
export function getAdapter() {
  if (cached) return cached;
  switch (INTEGRATION_MODE) {
    case ADAPTER_MODES.AGD:
      cached = createAgdAdapter();
      break;
    case ADAPTER_MODES.STANDALONE:
    default:
      cached = createStandaloneAdapter();
  }
  return cached;
}

export { ADAPTER_MODES };
