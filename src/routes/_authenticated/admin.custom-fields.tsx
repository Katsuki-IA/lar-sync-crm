import { createFileRoute } from "@tanstack/react-router";
import { GlobalCustomFieldsPage } from "./settings.custom-fields";

export const Route = createFileRoute("/_authenticated/admin/custom-fields")({
  component: GlobalCustomFieldsPage,
});
