import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  id?: string;
  variant?: 'default' | 'subtle' | 'bordered';
}

export const Card: React.FC<CardProps> = ({
  children,
  className = '',
  id,
  variant = 'default',
  ...props
}) => {
  const variantStyles = {
    default: 'bg-white border-stone-200 shadow-xs',
    subtle: 'bg-stone-50 border-stone-200/80 shadow-none',
    bordered: 'bg-white border-stone-300 shadow-none',
  };

  return (
    <div
      id={id}
      className={`rounded-xl border ${variantStyles[variant]} p-5 transition-shadow ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`mb-4 pb-3 border-b border-stone-100 flex flex-col gap-1 text-start ${className}`} {...props}>
    {children}
  </div>
);

export const CardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <h3 className={`text-base font-bold text-stone-900 leading-snug ${className}`} {...props}>
    {children}
  </h3>
);

export const CardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <p className={`text-xs text-stone-500 leading-relaxed ${className}`} {...props}>
    {children}
  </p>
);

export const CardContent: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`text-sm text-stone-700 ${className}`} {...props}>
    {children}
  </div>
);

export const CardFooter: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`mt-4 pt-3 border-t border-stone-100 flex items-center justify-between text-xs ${className}`} {...props}>
    {children}
  </div>
);
