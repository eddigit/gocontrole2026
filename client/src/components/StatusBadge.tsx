import clsx from 'clsx';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md' | 'lg';
}

const statusConfig: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  ONLINE: { label: 'En ligne', bg: 'bg-green-50', text: 'text-green-700', dot: 'bg-green-500' },
  LIKELY_ONLINE: { label: 'Prob. en ligne', bg: 'bg-lime-50', text: 'text-lime-700', dot: 'bg-lime-500' },
  UNCERTAIN: { label: 'Incertain', bg: 'bg-yellow-50', text: 'text-yellow-700', dot: 'bg-yellow-500' },
  LIKELY_OFFLINE: { label: 'Prob. hors ligne', bg: 'bg-orange-50', text: 'text-orange-700', dot: 'bg-orange-500' },
  OFFLINE: { label: 'Hors ligne', bg: 'bg-red-50', text: 'text-red-700', dot: 'bg-red-500' },
};

export default function StatusBadge({ status, size = 'md' }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.OFFLINE;

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-medium',
        config.bg,
        config.text,
        {
          'px-2 py-0.5 text-xs': size === 'sm',
          'px-2.5 py-1 text-sm': size === 'md',
          'px-3 py-1.5 text-base': size === 'lg',
        },
      )}
    >
      <span className={clsx('rounded-full animate-pulse', config.dot, {
        'w-1.5 h-1.5': size === 'sm',
        'w-2 h-2': size === 'md',
        'w-2.5 h-2.5': size === 'lg',
      })} />
      {config.label}
    </span>
  );
}
