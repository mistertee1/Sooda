import React from 'react';
import { Info, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';

export interface AlertProps {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  id?: string;
  className?: string;
}

export const Alert: React.FC<AlertProps> = ({
  variant = 'info',
  title,
  children,
  id,
  className = '',
}) => {
  const configs = {
    info: {
      icon: <Info className="w-5 h-5 text-sky-600 shrink-0" />,
      container: 'bg-sky-50/80 border-sky-200 text-sky-900',
      title: 'text-sky-950',
    },
    success: {
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />,
      container: 'bg-emerald-50/80 border-emerald-200 text-emerald-900',
      title: 'text-emerald-950',
    },
    warning: {
      icon: <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />,
      container: 'bg-amber-50/80 border-amber-200 text-amber-900',
      title: 'text-amber-950',
    },
    error: {
      icon: <XCircle className="w-5 h-5 text-rose-600 shrink-0" />,
      container: 'bg-rose-50/80 border-rose-200 text-rose-900',
      title: 'text-rose-950',
    },
  };

  const config = configs[variant];

  return (
    <div
      id={id}
      role="alert"
      className={`rounded-lg border p-3.5 flex items-start gap-3 text-start text-sm ${config.container} ${className}`}
    >
      <div className="mt-0.5">{config.icon}</div>
      <div className="flex-1 min-w-0">
        {title && <h5 className={`font-semibold text-sm mb-1 ${config.title}`}>{title}</h5>}
        <div className="leading-relaxed opacity-90">{children}</div>
      </div>
    </div>
  );
};
