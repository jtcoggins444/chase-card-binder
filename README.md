# Chase Card Binder

A personal Pokémon chase-card checklist with daily TCGplayer prices. You can install it as an app on your phone and computer, and your marks stay in sync between them.

- **The app** is `index.html`. GitHub Pages serves it from this repository.
- **Prices** update every night. `.github/workflows/update.yml` runs `scripts/update.mjs`, which pulls TCGplayer prices from TCGCSV, saves them under `data/days/`, and rebuilds `index.html` from `data/template.html`. To update by hand, open the **Actions** tab, choose **Nightly price update**, then click **Run workflow**.
- **Sync** uses Firebase: `sync.js` handles it and `firebase-config.js` holds the settings. Your Owned/Want marks, paid prices and conditions are stored in Firestore under your own account. The Firestore rules let only you read or write them.
- **Offline use** comes from `sw.js`, which keeps the last copy of the app so it opens without a connection.

The card list comes from the open pokemon-tcg-data project. Prices are TCGplayer market prices via TCGCSV.
