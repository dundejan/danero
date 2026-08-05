-- Účty založené před zavedením povinného ověření e-mailu (requireEmailVerification)
-- se označí za ověřené. Bez toho by se po nasazení nepřihlásily: ověřovací e-mail
-- v době jejich registrace nikdy neodešel, takže by po nich Danero chtělo
-- potvrzení něčeho, co nikdy nedostaly.
UPDATE "user" SET "email_verified" = true WHERE "email_verified" = false;
