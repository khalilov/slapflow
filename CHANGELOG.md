# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-09-04

### Added

- Reusable `when` expressions via the `guards` map on `Config`, referenced with the `['guard', name]` node. Guards are expanded once at `loadConfig`; `GUARD_NOT_FOUND`, `GUARD_CYCLE`, and `GUARD_INVALID` are reported during validation.
- Wildcard pub/sub subscriptions: `*` matches exactly one dot-delimited segment. Wildcards work in `bus.on`/`bus.off` and in `createWS` `inboundTopics`/`outboundTopics`.
- Agent guide (`AGENTS.md`) describing how to edit a graph.

### Changed

- `Bus.on`/`Bus.off` now accept a wildcard `EventPattern`; pattern handlers receive `parsed` as `unknown`.

### Documented

- Action return normalization, chain interruption semantics, and project positioning ("when to use Slapflow").

## [1.0.2] - 2026-08-29

- Link slapflow-studio as an example app.

## [1.0.1] - 2026-08-29

## [1.0.0] - 2026-08-29

- Initial release: `slapflow` — a runtime for declaring orchestration as a graph. The project was migrated from [`chain-functions-behavior`](https://www.npmjs.com/package/chain-functions-behavior) and rebranded with a new public API.

