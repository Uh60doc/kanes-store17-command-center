import { formatFigure, type Figure } from './model.ts';

export function FigureValue({ figure }: { figure: Figure }) {
  const text = formatFigure(figure);
  if (figure.kind === 'missing') {
    return <span className="status">{text}</span>;
  }
  return (
    <span className="amount" data-value={String(figure.value)}>
      {text}
    </span>
  );
}
