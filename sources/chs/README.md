# CHS tide station identity

`stations.json` lists the live CHS tide stations that are not curated in `metadata/registry.yaml`: an id, name, aliases and position for each. It carries no constituents, predictions, or IWLS station codes. A consumer resolves a station's IWLS code at runtime by position.

Ids are the ones Slackwater iOS ships, because devices key fitted models by them. `seed.ts` took them once from the app's `Slackwater/Resources/chs-stations.json`, keeping only stations whose id already held a slug here.

To refresh from IWLS (about 20 minutes, because every station is probed for predictions):

    npm run import -w sources/chs

A station keeps its id while an IWLS station sits within 200 m of it or carries exactly its name. A new station gets `chs-` plus the slug of its name. A station IWLS drops leaves the list, and `npm run metadata:lock` tombstones its slug. A station within 200 m of a registry tide port is that port's water and is skipped.
