# Crypto Downloads (owner's guide)

Sell digital downloads (ebooks, music, templates, software, photo packs) for **Bitcoin, Ethereum and TON**. Payments go straight into **your own wallets**: nothing is held by VibePress or anyone else, and no keys are ever needed. A buyer gets the file only after their payment is seen on the blockchain.

## Set it up (about 10 minutes)

1. **Install** the plugin: Admin > Plugins > upload `crypto-downloads-1.0.0.vpplugin`, read the review, tick every box.
2. **Upload your files**: Plugins > Crypto Downloads > **Files**. They are stored privately (never in your public web folder). Keep your own copies too: site backups do not include these files.
3. **Open Settings** and fill in:
   * your **receiving addresses** for the coins you want to accept (leave the others empty). Each address is checked for typos before it is saved. Use addresses from wallets **you** control. Make a fresh address just for the shop if you can.
   * how many confirmations you want, how long a buyer has to pay, how many downloads each purchase allows, and for how many days.
   * your **products**: a title, a short description, the file, and a price in each coin you accept (leave a price empty to not sell that product for that coin). Prices are fixed coin amounts, not dollar prices, so you decide exactly what you receive. Update them now and then if the coin prices move.
4. **Make the shop visible**: on the plugin's card press **Add to the menu** (and/or **Add to the home page**). Until you do, nobody can find it; it lives at `/x/crypto-downloads/`.
5. **Make a real test purchase for each coin before you announce it** (see below).

## The shop says "not open yet" (or "technical problem")?
Press **Setup check** on the plugin's card (it also shows at the top of **Settings**). It lists exactly what is missing. The shop opens when at least one product has **a file chosen** and **a price in a coin whose wallet address you entered**. The usual mistakes: no file uploaded, no file chosen on the product, or a price only in a coin that has no address.

If the shop page says **"The shop has a technical problem"** instead, the plugin's server part is not running. Open **Status** on the plugin's card: it runs a live test and shows the reason. Server plugins need Node 22.13 or newer (`node -v`); `node /var/www/vibepress/app/plugins/selftest.js` tests the sandbox itself.

## What your buyers see
They pick a product and a coin, then see an exact amount, your address, a QR code, and a countdown. They pay from their wallet. The page checks by itself; when the payment is confirmed, a **Download** button appears. The address of the page remembers their order, so they can bookmark it and come back. Each download link lasts 10 minutes; each purchase allows a limited number of downloads (you choose).

## How a payment is recognised
* **Bitcoin and Ethereum:** every order gets a slightly different amount: your price plus a tiny extra (up to 300 satoshi, or up to about 0.00001 ETH). No two open orders share an amount, so the exact amount tells VibePress which order was paid. **The buyer must send exactly that amount.** (This is why paying from an exchange that subtracts its withdrawal fee from the amount does not work unless the buyer adds the fee on top.)
* **TON:** the buyer adds a short **comment** (like `CD7K2Q9X`) to the payment. The amount must be at least the price. Without the comment the payment cannot be matched.
* A payment counts only when it is on the blockchain with enough confirmations, is not older than the order, and has not already been used for another order. Payments that arrive up to 3 hours after the buyer's payment window are still matched.

## Seeing and fixing orders
Plugins > Crypto Downloads > **Orders**: every order, newest first, with a **Paid / Unpaid** state and the transaction id. If a customer paid but was not recognised (wrong amount, missing comment, a slow network), find the payment in your wallet and press **Mark as paid**; their page unlocks within seconds. **Mark as unpaid** takes access back. Refunds are done by you, from your wallet.

## Please test with real money first (important)
The plugin reads public blockchain services (mempool.space and blockstream.info for Bitcoin, Blockscout for Ethereum, TonAPI and toncenter for TON). These services can change how they answer. The plugin's logic is tested thoroughly, but it has **not** been checked against the live services by its author, so before you rely on it:

1. Add a cheap test product (for example 0.00001 BTC / 0.0005 ETH / 0.1 TON).
2. Buy it yourself, from a wallet, with each coin you accept.
3. Check that the page notices the payment and the download works.

If a coin is not recognised automatically, you can still use **Mark as paid**, and you can tell us which service changed. Ethereum payments are only credited automatically when the service reports the number of confirmations; if it does not, nothing is guessed.

## Good to know
* **Busy shops:** each open BTC order reserves one of 300 small amounts for up to 4 hours (60 minutes plus the 3 hour grace). If a flood of fake orders fills them, new BTC buyers see "busy" for a while. TON orders (identified by comment) are not affected.
* **Detection takes a little while:** the page checks every 10 seconds, results are shared for 15 seconds, and Bitcoin needs your chosen number of confirmations (about 10 minutes each).
* **Limits:** up to 30 products, 1500 stored orders (the oldest are dropped), files up to 500 MB each (the server admin can change this).
* **Several coins, one shop:** you can mix coins freely; a product may have any combination of prices.

## Safety notes
* The plugin can never see or move your coins. It only knows your public receiving addresses.
* Files are stored privately; the plugin can only create short-lived links, never read the files.
* Buyers' pages run in a browser sandbox and cannot reach your admin.
* Treat your wallet addresses as the most important setting: re-read them after saving.

## Your responsibilities
This is software, not legal, tax or financial advice. Selling digital goods may bring obligations where you or your buyers live (taxes such as VAT or income tax, consumer refund rules, record keeping, sanctions or know-your-customer rules). Check what applies to you.
