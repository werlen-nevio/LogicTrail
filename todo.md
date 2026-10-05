Punkt 1 ist umgesetzt. Bei Punkt 2 habe ich die CHANGELOG-Links angepasst, und die Todo-Liste für 4–7 steht unten. Committet ist noch nichts.

**1. CI bei Pull Requests:** [ci.yml](.github/workflows/ci.yml#L6-L7) läuft jetzt auch bei PRs auf `main`, nicht mehr nur bei Pushes. Prettier und `scripts/release.mjs` laufen ohne Fehler durch.

**2. CHANGELOG-Links:** Da es `v0.1.0` nie geben wird, zeigt `[0.2.0]` in [CHANGELOG.md](CHANGELOG.md#L52) jetzt direkt auf das Release `v0.2.0`. Den `[0.1.0]`-Link habe ich entfernt, die Überschrift bleibt einfach ohne Link. Sobald du `v0.2.0` gepusht hast, funktionieren alle Links. Die Tag-Prüfung für `v0.2.0` läuft durch, und es ist egal, ob du vor oder nach dem Commit dieser beiden Änderungen taggst.

**3.** Habe ich mir notiert: Trusted Publishing ist eingerichtet.

## Todo

**Sicherheit** (Settings → Advanced Security)
- [ ] Secret Protection mit Push protection einschalten
- [ ] Dependabot alerts und Dependabot security updates einschalten
- [ ] Private vulnerability reporting einschalten
- [ ] `SECURITY.md` anlegen: Lücken bitte privat über den Security-Tab melden, nicht als Issue
- [ ] Optional `.github/dependabot.yml` für npm und github-actions, wöchentlich

**Rulesets** (Settings → Rules → Rulesets)
- [ ] Branch-Ruleset für `main`: Restrict deletions und Block force pushes. Optional zusätzlich Require status checks, dafür die CI-Jobs auswählen
- [ ] Tag-Ruleset für `v*`: nur du darfst Tags erstellen, ändern oder löschen, weil jeder Tag-Push ein Release auslöst

**Auffindbarkeit**
- [ ] Beschreibung und Topics setzen (Repo-Startseite → Zahnrad bei „About“), oder so:
  ```
  gh repo edit werlen-nevio/LogicTrail --description "Ask your codebase how it works. LogicTrail turns a question into an evidence-backed, interactive execution flow." --add-topic cli,static-analysis,call-graph,code-visualization,typescript,javascript,mermaid,claude,developer-tools
  ```
- [ ] In der `package.json` `homepage` auf `https://werlen-nevio.github.io/LogicTrail/` setzen (wirkt erst ab dem nächsten npm-Release)

**Community-Dateien**
- [ ] Issue-Templates in `.github/ISSUE_TEMPLATE/` (Bug, Adapter-Wunsch)
- [ ] PR-Template `.github/pull_request_template.md`
- [ ] `CODE_OF_CONDUCT.md`

Die Liste habe ich mir auch gemerkt, damit ich sie beim nächsten Mal wieder aufgreifen kann. Die Dateien (SECURITY.md, dependabot.yml, Templates, Code of Conduct) kann ich dir jederzeit schreiben, und ich kann die Liste auch als GitHub-Issues anlegen.