import clsx from 'clsx';

interface ConfidenceMeterProps {
  confidence: number; // 0 to 1
  size?: 'sm' | 'md';
}

export default function ConfidenceMeter({ confidence, size = 'md' }: ConfidenceMeterProps) {
  const percent = Math.round(confidence * 100);

  const getColor = () => {
    if (percent >= 75) return 'bg-green-500';
    if (percent >= 50) return 'bg-lime-500';
    if (percent >= 30) return 'bg-yellow-500';
    if (percent >= 15) return 'bg-orange-500';
    return 'bg-red-500';
  };

  return (
    <div className={clsx('flex items-center gap-2', { 'gap-1.5': size === 'sm' })}>
      <div className={clsx('rounded-full bg-gray-200 overflow-hidden', {
        'w-16 h-1.5': size === 'sm',
        'w-24 h-2': size === 'md',
      })}>
        <div
          className={clsx('h-full rounded-full transition-all duration-500', getColor())}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className={clsx('font-mono font-medium text-gray-600', {
        'text-xs': size === 'sm',
        'text-sm': size === 'md',
      })}>
        {percent}%
      </span>
    </div>
  );
}
