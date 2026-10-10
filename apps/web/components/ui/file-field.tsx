'use client';

import { useEffect, useRef, useState } from 'react';
import { plural } from '@/lib/format';

/**
 * File input s českými texty — nativní „Choose Files / No file chosen“ nejde
 * přeložit, proto label stylovaný jako tlačítko + vizuálně skrytý input
 * (sr-only, ne display:none — validace `required` potřebuje fokusovatelný prvek).
 */
export function FileField({
  name,
  accept,
  multiple,
  required,
  ariaLabel,
}: {
  name: string;
  accept?: string;
  multiple?: boolean;
  required?: boolean;
  ariaLabel?: string;
}) {
  const [fileNames, setFileNames] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // reset formuláře (React ho po server action provede sám) nevyvolá onChange
  // — bez tohohle by zůstaly viset názvy souborů nad prázdným inputem
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const onReset = () => setFileNames([]);
    form.addEventListener('reset', onReset);
    return () => form.removeEventListener('reset', onReset);
  }, []);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
      <label className="pressable inline-flex h-9 shrink-0 cursor-pointer items-center rounded-full bg-control px-4 text-sm font-medium text-ink hover:brightness-95 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent pointer-coarse:h-11 dark:hover:brightness-125">
        Vybrat soubory
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          required={required}
          aria-label={ariaLabel}
          className="sr-only"
          onChange={(event) =>
            setFileNames([...(event.currentTarget.files ?? [])].map((file) => file.name))
          }
        />
      </label>
      <span className="min-w-0 truncate text-ink-muted">
        {fileNames.length === 0
          ? 'Žádný soubor nevybrán'
          : fileNames.length <= 3
            ? fileNames.join(', ')
            : `${fileNames.length} ${plural(fileNames.length, 'soubor', 'soubory', 'souborů')}`}
      </span>
    </div>
  );
}
