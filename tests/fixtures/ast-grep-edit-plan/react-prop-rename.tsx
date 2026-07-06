type Props = {
  label: string;
};

export function Demo({ label }: Props) {
  return <Widget oldName={label} />;
}
