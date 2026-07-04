import { createFileRoute } from "@tanstack/react-router";

import { ArkHomeSurface } from "../components/ArkHomeSurface";

export const Route = createFileRoute("/ark")({
  component: ArkHomeSurface,
});
