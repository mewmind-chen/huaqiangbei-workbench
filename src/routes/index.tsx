import { createFileRoute } from "@tanstack/react-router";
import { Workbench } from "@/components/workbench/workbench";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Workbench />;
}
