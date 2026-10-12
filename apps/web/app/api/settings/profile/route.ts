import { autoSaveProfile } from '@/app/(app)/nastaveni/save';
import { getAuth } from '@/lib/auth';
import { autoSaveResponse } from '@/lib/auto-save-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  return autoSaveResponse(request, session?.user.id ?? null, autoSaveProfile);
}
