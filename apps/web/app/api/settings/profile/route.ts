import { profileOutcome, saveProfile } from '@/app/(app)/nastaveni/save';
import { autoSaveResponse } from '@/lib/auto-save-route';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return autoSaveResponse(request, async (userId, formData) =>
    profileOutcome(await saveProfile(userId, formData)),
  );
}
