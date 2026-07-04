import { createArkEnvironmentAtoms } from "@t3tools/client-runtime/state/ark";

import { connectionAtomRuntime } from "../connection/runtime";

export const arkEnvironment = createArkEnvironmentAtoms(connectionAtomRuntime);
