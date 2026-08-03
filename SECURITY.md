# Hlášení bezpečnostních chyb

Danero pracuje s daňovými a investičními daty. Bezpečnostní nálezy bereme vážně
a jsme rádi za každý.

## Jak hlásit

- Přednostně přes **GitHub → Security → Report a vulnerability** (soukromé, viditelné jen nám).
- Nebo e-mailem na **dunder.jan@gmail.com** s předmětem `SECURITY`.

**Prosím ne do veřejných issue**, dokud chybu neopravíme.

## Co čekat

- Potvrzení přijetí do 72 hodin.
- Odhad závažnosti a termínu opravy do 7 dnů.
- Zveřejnění po opravě, se jmenovitým poděkováním, pokud si ho přeješ.

Projekt vede jeden člověk — **odměny za nálezy (bug bounty) nevyplácíme** a
v sezóně (únor–duben) může být reakce pomalejší. Nic z toho není důvod chybu
nenahlásit.

## Rozsah

| | |
|---|---|
| **Platí pro** | kód v tomto repozitáři a provozovanou službu na danero.cz |
| **Neplatí pro** | cizí instance Danera provozované někým jiným (za ty odpovídá jejich provozovatel), a nálezy typu „chybí hlavička X" bez doložitelného dopadu |

## Co v repozitáři nehledat

V repozitáři nejsou žádné klíče ani produkční tajemství — všechna se nastavují
env proměnnými (`apps/web/.env.example`) a lokálně se generují do `.data/`.
Pokud přesto nějaké najdeš, je to nález a chceme o něm vědět.

## Provozní bezpečnost služby danero.cz

- API klíče brokerů jsou vždy jen pro čtení a v databázi šifrované AES-256-GCM.
- Aplikace nenačítá nic z cizích CDN, běží pod striktní CSP a nemá analytiku
  třetích stran.
- Podrobnosti na [danero.cz/bezpecnost](https://danero.cz/bezpecnost).
