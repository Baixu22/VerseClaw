type WidgetProps = {
  oldName?: string;
  newName?: string;
};

function Widget(_props: WidgetProps) {
  return null;
}

export function ComponentView({ label }: { label: string }) {
  return <Widget oldName={label} />;
}

