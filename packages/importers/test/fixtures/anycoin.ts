/**
 * Anycoin fixtures — řádky doslova podle důkazů (WhaleBooks, oficiální
 * partner Anycoinu). CSV s čárkou, hlavička `Date,Type,Amount,Currency,Order ID`,
 * obchod = pár řádků trade payment + trade fill přes Order ID; staked assety
 * mají sufix `.S`.
 */

export const ANYCOIN_HEADER = 'Date,Type,Amount,Currency,Order ID';

/** Happy path: nákup BTC za CZK, prodej ADA za CZK, vklad/výběr, staking. */
export const ANYCOIN_BASIC = [
  ANYCOIN_HEADER,
  '2021-04-10T18:16:50.367Z,trade payment,-1000,CZK,113180',
  '2021-04-10T18:28:12.885Z,trade fill,0.00075667,BTC,113180',
  '2021-09-10T08:46:44.616Z,trade payment,-52,ADA,258362',
  '2021-09-10T08:46:47.763Z,trade fill,2676,CZK,258362',
  '2021-04-23T10:28:16.196Z,deposit,500,CZK',
  '2022-01-06T11:51:27.489Z,withdrawal,-0.07070279,BTC,',
  '2022-11-07T14:39:54.400Z,stake,-1.43092234,ATOM',
  '2022-11-07T14:45:15.967Z,stake,1.43092234,ATOM.S',
  '2022-10-29T14:24:12.531Z,stake_reward,0.00334145,SOL.S',
].join('\n');

/** Směna krypto–krypto (ETH → BTC) — pár bez fiat protihodnoty. */
export const ANYCOIN_CRYPTO_SWAP = [
  ANYCOIN_HEADER,
  '2022-05-01T10:00:00.000Z,trade payment,-0.5,ETH,300001',
  '2022-05-01T10:00:05.000Z,trade fill,0.03,BTC,300001',
].join('\n');

/** Nespárované obchodní řádky: payment bez fill + fill bez Order ID. */
export const ANYCOIN_UNPAIRED = [
  ANYCOIN_HEADER,
  '2022-06-01T10:00:00.000Z,trade payment,-1000,CZK,400001',
  '2022-06-02T10:00:00.000Z,trade fill,0.001,BTC,',
].join('\n');

/** Vrácený obchod, blokace výběru, unstake pár a neznámý typ. */
export const ANYCOIN_MISC = [
  ANYCOIN_HEADER,
  '2022-07-01T10:00:00.000Z,trade refund,1000,CZK,500001',
  '2022-07-02T10:00:00.000Z,withdrawal_block,-0.1,BTC,',
  '2022-07-02T11:00:00.000Z,withdrawal_unblock,0.1,BTC,',
  '2022-07-04T10:00:00.000Z,unstake,-1.43092234,ATOM.S,',
  '2022-07-04T10:05:00.000Z,unstake,1.43092234,ATOM,',
  '2022-07-05T10:00:00.000Z,airdrop,5,XRP,',
].join('\n');
