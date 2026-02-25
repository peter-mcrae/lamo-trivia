import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center font-semibold rounded-pill transition-colors';
  const variants = {
    primary: 'px-6 py-2.5 bg-lamo-blue text-white hover:bg-lamo-blue-dark',
    secondary: 'px-6 py-2.5 border border-lamo-border text-lamo-dark hover:bg-lamo-bg',
  };

  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
