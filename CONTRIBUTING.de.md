# Mitwirken

**Sprachen:** [English](CONTRIBUTING.md) · [Español](CONTRIBUTING.es.md) · [简体中文](CONTRIBUTING.zh-CN.md) · [Deutsch](CONTRIBUTING.de.md)

Danke für deinen Beitrag zu Web Agent.

## Inhalt

- [Grundsätze](#grundsätze)
- [Entwicklungsumgebung](#entwicklungsumgebung)
- [Nützliche Befehle](#nützliche-befehle)
- [Vor dem Pull Request](#vor-dem-pull-request)
- [Fehler melden](#fehler-melden)
- [Pull-Request-Stil](#pull-request-stil)
- [Dokumentation für Mitwirkende](#dokumentation-für-mitwirkende)

## Grundsätze

- Halte Änderungen chirurgisch klein.
- Keine unnötige Komplexität.
- Entferne veralteten Code, den deine Änderung verursacht.
- Bewahre das browser-native, local-first und isolierte Design.
- Keine Profile-Workspace-Spiegel committen (`memory/`, `tmp/`, `knowledge-vault/`, `.webagent/`, SQLite-DBs usw.): sie gehören in den Browser-Speicher und stehen in `.gitignore`.

## Entwicklungsumgebung

```bash
git clone https://github.com/nikola66/web-agent.git
cd web-agent
git lfs install
git lfs pull
npm install
npm run dev
```

Öffne `http://localhost:5173`. `npm install` im Root installiert Judge-Sidecar-Abhängigkeiten per `postinstall`. Das ONNX-Modell liegt unter `models/turn-judge/` — siehe [docs/turn-judge.md](docs/turn-judge.md).

## Nützliche Befehle

```bash
npm run dev
npm run build
npm run test
npm run judge:test
npm run test:browser
```

## Vor dem Pull Request

- prüfen, ob die Änderung ein echtes Problem löst
- den Diff fokussiert halten
- Docs bei Verhaltensänderungen aktualisieren (zuerst Englisch, dann `*.es.md`, `*.zh-CN.md`, `*.de.md` bei nutzersichtbarem Text)
- Tests ergänzen oder anpassen, wenn das Runtime-Verhalten betroffen ist
- keine unrelated Refactors

Bei Browser-Persistenz, Runtime-Isolation, Uploads, Tools oder Profile-State die Auswirkung in der PR-Beschreibung erklären.

## Fehler melden

GitHub-Issue mit:

- Erwartung
- tatsächlichem Verhalten
- exakten Reproduktionsschritten
- Browser und Betriebssystem
- ob es im gehosteten Demo, lokal oder beidem auftritt

Sicherheitsrelevante Meldungen über [SECURITY.md](SECURITY.md), nicht als öffentliches Issue.

## Pull-Request-Stil

- kleinste korrekte Lösung bevorzugen
- bestehenden Codestil einhalten
- tote Imports, veraltete Zweige und lokale Reste entfernen
- nutzersichtliche Texte knapp und konkret halten

## Dokumentation für Mitwirkende

- [README.de.md](README.de.md)
- [CAPABILITIES.md](CAPABILITIES.md)
- [docs/README.de.md](docs/README.de.md)
- [docs/ARCHITECTURE.de.md](docs/ARCHITECTURE.de.md)
- [docs/turn-judge.md](docs/turn-judge.md)
- [docs/agent-notes.md](docs/agent-notes.md)
- [docs/testing-checklist.md](docs/testing-checklist.md)
