import FlowEditor from "@/components/flows/flow-editor";

export default async function FlowEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed so jumping to another flow (start-flow links) starts with fresh state.
  return <FlowEditor key={id} flowId={id} />;
}
