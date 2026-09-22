import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@starter/shared-utils';

export type ButtonVariant = 'primary' | 'secondary';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary:
    'bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-100',
};

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 disabled:opacity-50',
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}

export default Button;
