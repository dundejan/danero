import { cn } from '@/lib/utils';

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-sm font-medium', className)} {...props} />;
}

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-md border border-linka bg-plocha px-3 text-sm text-inkoust placeholder:text-inkoust-tlumeny',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-md border border-linka bg-plocha px-3 text-sm text-inkoust',
        className,
      )}
      {...props}
    />
  );
}
