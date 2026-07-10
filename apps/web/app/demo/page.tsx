import { redirect } from 'next/navigation';

/** /demo (odkazy z landing page a e-mailů) → vstupní stránka prohlídky. */
export default function DemoIndexPage() {
  redirect('/demo/prehled');
}
