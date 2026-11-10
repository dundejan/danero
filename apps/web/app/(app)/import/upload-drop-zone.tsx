'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Táhne uživatel soubory? Označený text, odkaz nebo obrázek ze stránky typ
 * `Files` nenese — ty necháváme prohlížeči.
 */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/** Je otevřený modální dialog? Soubory puštěné nad ním do formuláře pod ním nepatří. */
function modalOpen(): boolean {
  return document.querySelector('dialog[open]') !== null;
}

/** Pole bez `multiple` unese jen jeden soubor — vezme se první. */
function firstOnly(files: FileList): FileList {
  const transfer = new DataTransfer();
  transfer.items.add(files[0]!);
  return transfer.files;
}

/**
 * Karta formuláře pro nahrání, do které jde soubory přetáhnout.
 *
 * Puštěné soubory se vloží do existujícího `<input type="file">` uvnitř
 * a vyvolá se na něm `change` — formulář, validace `required`, výpis názvů
 * ve `FileField` i úklid po odeslání (`reset`) tak fungují beze změny.
 * Neodesílá se samo: uživatel uvidí názvy a klikne na tlačítko, na které se
 * přesune fokus (špatně puštěný soubor se dá vyměnit bez následků).
 *
 * Soubor puštěný KDEKOLI na stránce skončí taky tady. Prohlížeč by jinak
 * soubor otevřel místo stránky (uživatel přijde o stránku) a jiný cíl pro
 * soubory na /import není — o kousek vedle mířené puštění tak nic nepokazí
 * a nevyjde naprázdno. Proto se karta zvýrazní, jakmile soubory vjedou do
 * okna, a ne až nad ní: ukazuje, kam soubory dopadnou. Na telefonu se nic
 * nemění, přetahování souborů tam není.
 *
 * Počítadlo `dragenter`/`dragleave`: obě události chodí při každém přejezdu
 * přes potomka (vstup do potomka přijde dřív než odchod z rodiče), takže
 * zvýraznění podle jediné z nich by blikalo. Klávesnice a čtečky jdou dál
 * tlačítkem „Vybrat soubory“ — překryv je jen vizuální a kliky propouští.
 */
export function UploadDropZone({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    let depth = 0;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      depth = 0;
      clearTimeout(watchdog);
      setDragging(false);
    };
    const onEnter = (event: DragEvent) => {
      if (!carriesFiles(event) || modalOpen()) return;
      depth += 1;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(depth - 1, 0);
      if (depth === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      // bez zrušení výchozí akce by `drop` nepřišel a prohlížeč soubor otevřel
      event.preventDefault();
      if (modalOpen()) {
        // nad dialogem („Vrátit import zpět?“) soubor nepatří nikam — jen ho
        // nenecháme prohlížeči otevřít
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
        return;
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      // Pojistka proti zaseknutému zvýraznění: když prvek pod kurzorem během
      // tažení zmizí (obnovení stránky po doběhlé synchronizaci), `dragleave`
      // nepřijde a počítadlo zůstane nad nulou. `dragover` chodí, dokud se
      // nad oknem táhne (i bez pohybu, Firefox po ~350 ms), takže jeho
      // utichnutí znamená konec tažení.
      clearTimeout(watchdog);
      watchdog = setTimeout(stop, 1000);
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      stop();
      if (modalOpen()) return;
      const files = event.dataTransfer?.files;
      const input = zoneRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
      if (!files || files.length === 0 || !input || input.disabled) return;
      const submit = input.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      // Během „Nahrávám a počítám…“ by puštěné soubory jen přepsaly pole,
      // které se po odeslání vyprázdní — nenahrály by se a nikdo by to nepoznal.
      if (submit?.disabled) return;
      input.files = input.multiple ? files : firstOnly(files);
      // React poslouchá `change` u souborového pole delegovaně na kořeni —
      // událost musí bublat, jinak se názvy ve `FileField` neukážou
      input.dispatchEvent(new Event('change', { bubbles: true }));
      (submit ?? input).focus();
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    // Esc nebo puštění mimo okno: `dragleave` z okna přijde, ale pojistka
    // nic nestojí — tažení skončilo, zvýraznění nesmí zůstat viset
    // (`dragend` chodí jen u tažení začatého na stránce, ne ze systému)
    window.addEventListener('dragend', stop);
    return () => {
      clearTimeout(watchdog);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', stop);
    };
  }, []);

  return (
    <div
      ref={zoneRef}
      data-dragging={dragging ? '' : undefined}
      className={cn(
        'relative rounded-xl bg-canvas p-5 outline-offset-2',
        dragging && 'outline-2 outline-dashed outline-accent',
        className,
      )}
    >
      {children}
      {dragging && (
        <div
          aria-hidden
          className="type-callout pointer-events-none absolute inset-0 flex items-center justify-center rounded-xl bg-canvas/90 font-medium text-accent-text"
        >
          Pusť soubory sem
        </div>
      )}
    </div>
  );
}
