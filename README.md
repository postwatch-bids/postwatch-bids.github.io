# PostWatch
Free static site listing open US security guard / patrol bids. `npm ci && npm run update && npm run serve`.
Sources: SAM.gov public Contract Opportunities CSV extract (keyless), USAspending.gov API (keyless), Texas ESBD public search. Daily refresh via `.github/workflows/update.yml`.
TODO: newsletter, sponsor slot, software referral link, real domain (placeholder postwatch-bids.github.io).

## Community submissions
- Site form "Send by email" opens a prefilled mailto to octopuslaboratoryllc@gmail.com. To approve: add the bid to `data/manual-bids.json` and commit.
- Site form "Or submit on GitHub" opens the prefilled issue form (`bid-submission` label). To approve: add the `approved` label; the workflow runs and publishes it.
- Past-deadline community bids hide automatically. Source tag: "Community submitted".
