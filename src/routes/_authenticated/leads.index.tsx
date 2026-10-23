import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/hml/contacts";
export const Route = createFileRoute("/_authenticated/leads/")({ component: ContactsPage });

